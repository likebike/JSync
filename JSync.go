// This a direct translation from JSync.js , that's why none of this is idiomatic Go.
// After I get it running, I'll probably do another translation pass, implementing idiomatic Go and SSE.

// It would be good to rename 'clientID' to 'connectionID' since it represents an ephemeral connection.
// Also, 'browserID' would be better named 'clientID' since it is the ID of the client (browser, Go, or whatever).  But I don't think i'll change that since 'clientID' already means something else.

package JSync

import (
    "seb"
    "seb/dyn"
    "seb/solo"
    "encoding/json"
    "unicode/utf8"
    "regexp"
    "math/rand"
    "time"
    "reflect"
    "sync"
    "strconv"
    "fmt"
    "os"
    "errors"
)
type D=dyn.D

func init() { rand.Seed(time.Now().UnixNano()) }  // The math/rand uses a constant seed by default.

var VERSION="201802241630";


/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// This first section deals with the delta algorithm.  No async, no events, no network.  Just Deltas.
//


func Parse(s string, o interface{}) interface{} {
    if e:=json.Unmarshal([]byte(s),o); e!=nil { panic(e) }
    return o
}
func Stringify(o interface{}) (s string) {
    bs,e:=json.Marshal(o); if e!=nil { panic(e) }
    s=string(bs)
    return
}

func Pad(s,p string, n int) string {
    for utf8.RuneCountInString(s)<n { s=p+s }
    return s
}

var ID_CHARS = []byte("0123456789abcdefghijkmnopqrstuvwxyzABCDEFGHIJKLMNPQRSTUVWXYZ")  // Removed l and O because they are easily confused with 1 and 0.
var ID_REGEX *regexp.Regexp; func init() { r,e:=regexp.Compile("^["+string(ID_CHARS)+"]+$"); seb.Zssert(e); ID_REGEX=r }
func _generateID(length int) string {
    if length<=0 { length=8 }
    id:=make([]byte,0,length)
    for len(id)<length { id=append(id, ID_CHARS[rand.Intn(len(ID_CHARS))]) }
    return string(id)
}
func _newID(length int, m interface{}) (id string) {
    for {
        id=_generateID(length)
        if reflect.ValueOf(m).MapIndex(reflect.ValueOf(id)).IsValid() { continue }
        return
    }
}
var _ids=struct { sync.Mutex; m map[string]bool }{m:make(map[string]bool)}
func NewID() (id string) {
    _ids.Lock(); defer _ids.Unlock()
    id=_newID(0,_ids.m)
    _ids.m[id]=true
    return
}
func DelID(id string) {  // Use this after you're done with an ID.
    _ids.Lock(); defer _ids.Unlock()
    if !_ids.m[id] { panic("Tried to delete non-existent ID") }
    delete(_ids.m, id)
}

var _globals=struct { sync.Mutex; m map[string]interface{} }{m:make(map[string]interface{})}
func NewGlobal(v interface{}) (id string) {
    _globals.Lock(); defer _globals.Unlock()
    id=_newID(0,_globals.m)
    _globals.m[id]=v
    return
}
func GetGlobal(id string) interface{} {
    _globals.Lock(); defer _globals.Unlock()
    v,has:=_globals.m[id]; if !has { panic("Unknown global key!") }
    return v
}
func PopGlobal(id string) interface{} {
    _globals.Lock(); defer _globals.Unlock()
    v,has:=_globals.m[id]; if !has { panic("Unknown global key!") }
    delete(_globals.m, id)
    return v
}

func DSHash(s string) string { // The Down Syndrome Hash algorithm, translated from JS.
    h:=uint32(0x12345678)
    for i,c:=range []rune(s) {
        code:=int32(c)
        h+=uint32(code+1)*uint32(i+1)
        h%=0xffffffff  // redundant because we already know that we are really working with uint32 in Go, compared to JS where we don't really know what the size is.
        shifts:=uint((code+1)%32)
        h=(h<<shifts) | (h>>(32-shifts))
    }
    return "0x"+Pad(strconv.FormatInt(int64(h>>24),16),"0",2)+Pad(strconv.FormatInt(int64(h&0xffffff),16),"0",6)
}



type M map[string]interface{}
func (m M) Extend(ms ...M) M {
    for _,m2:=range ms {
        for k,v:=range m2 { m[k]=v }
    }
    return m
}

func TargetV(o reflect.Value, path []interface{}) reflect.Value {
    o=dyn.Deref(o)
    for _,p:=range path { o=dyn.Deref(D(o).GetVOrPanic(p)) }
    return o
}
func Target(o interface{}, path []interface{}) interface{} { return TargetV(reflect.ValueOf(o), path).Interface() }

func DeepCopy(o interface{}) interface{} {
    inData,wasPointer:=reflect.ValueOf(o),false
    if inData.Kind()==reflect.Ptr {
        inData,wasPointer=inData.Elem(),true
    }
    out:=reflect.New(inData.Type()).Interface()
    Parse(Stringify(o),out)
    if !wasPointer { out=reflect.ValueOf(out).Elem().Interface() }
    return out
}
func DeepEqual(a,b interface{}) bool { return Stringify(a)==Stringify(b) }
func isInt(o interface{}) bool { _,ok:=o.(int); return ok }

type Operation struct {
    Op    string        `json:"op"`
    Path  []interface{} `json:"path"`
    Key   interface{}   `json:"key"`
    Value interface{}   `json:"value"`
}
type Operations []Operation
type DeltaStep struct {
    Op               string
    Path             []interface{}
    Key,Before,After interface{}
}
type Delta struct {
    EndHash   string        `json:"endHash"`
    StartHash string        `json:"startHash"`
    Steps     []DeltaStep   `json:"steps"`
}
func (s DeltaStep) MarshalJSON() ([]byte,error) {
    out:=map[string]interface{}{"op":s.Op, "key":s.Key}
    path:=s.Path; if path==nil { path=[]interface{}{} }; out["path"]=path // Match the JS behavior of always including a 'path' field, even when it's just a blank list.
    if s.Before!=nil { out["before"]=s.Before }
    if s.After!=nil { out["after"]=s.After }
    return json.Marshal(out)
}

// The JSync.Edit function is used to modify objects, and also
// produce the equivalent delta that represents the same edit operation.
// If you just need a delta, and don't want to actually modify your object,
// then just make a copy first, like this:
//     JSync.Edit(JSync.DeepCopy(myObj), myOps)
// ...or send in a value type instead of a pointer/reference type.
func Edit(obj interface{}, operations Operations) Delta {  // racey!  You need to manage concurrency from a higher level.
    origObjStr,steps:=Stringify(obj),[]DeltaStep{}
    defer func(){
        if e:=recover(); e!=nil {
            if len(steps)>0 {
                fmt.Fprintln(os.Stderr, "Edit Failed.  Rolling back...")
                ApplyDelta(obj, ReverseDelta(Delta{Steps:steps}))
                if Stringify(obj)!=origObjStr { fmt.Fprintln(os.Stderr, "Rollback Failed!") }
            }
            panic(e)
        }
    }()
    objV:=reflect.ValueOf(obj)
    for _,step:=range operations {
        op:=step.Op
        path:=step.Path
        key:=step.Key
        value:=step.Value
        target:=TargetV(objV, step.Path)
        switch op {
        case "create","update","update!":
            if key==nil { panic("nil key!") }
            if value==nil { panic("nil value!") }  // If you want to set something to undefined, just delete instead.
            I,has:=D(target).Get(key)
            if op=="update!" {
                if has { op="update" } else { op="create" }
            }
            if op=="create" {
                if has { panic(fmt.Sprintf("Already in target: %#v",key)) }
                D(target).Set(key,value)

                steps=append(steps,DeltaStep{Op:op, Path:path, Key:key, After:DeepCopy(value)})
            } else if op=="update" {
                if !has { panic(fmt.Sprintf("Not in target: %#v",key)) }
                before:=DeepCopy(I)
                // We do NOT check if 'before' and 'after' are equal, or try to detect NOOP operations (setting the same value that already exists, etc.).  Logical linearity is more important than saving a few steps.
                D(target).Set(key,value)
                steps=append(steps,DeltaStep{Op:op, Path:path, Key:key, Before:before, After:DeepCopy(value)})
            } else { panic("Inconceivable!") }
        case "delete":
            if key==nil { panic("nil key!") }
            I,has:=D(target).Get(key); if !has { panic(fmt.Sprintf("Not in target: %#v",key)) }
            before:=DeepCopy(I)
            D(target).Del(key)
            steps=append(steps,DeltaStep{Op:op, Path:path, Key:key, Before:before})
        case "arrayPush":
            if key!=nil { panic("arrayPush: Expected key to be nil!") }
            if target.Kind()!=reflect.Slice { panic("arrayPush: Expected a Slice target!") }
            op="arrayInsert"
            key=target.Len()
            fallthrough
        case "arrayInsert":
            if key==nil { panic("nil key!") }
            if value==nil { panic("nil value!") }
            if !isInt(key) { panic("Expected an int key!") }
            D(target).SliceInsert(key,value)
            steps=append(steps,DeltaStep{Op:op, Path:path, Key:key, After:DeepCopy(value)})
        case "arrayPop":
            if key!=nil { panic("arrayPop: Expected key to be nil!") }
            if target.Kind()!=reflect.Slice { panic("arrayPop: Expected a Slice target!") }
            op="arrayRemove"
            key=target.Len()-1
            fallthrough
        case "arrayRemove":
            if key==nil { panic("nil key!") }
            if value!=nil { panic("non-nil value!") }
            if !isInt(key) { panic("Expected an int key!") }
            before:=DeepCopy(D(target).GetOrPanic(key))
            D(target).SliceRemove(key)
            steps=append(steps,DeltaStep{Op:op, Path:path, Key:key, Before:before})
        default: panic("Illegal operation: "+op)
        }
    }
    return Delta{StartHash:DSHash(origObjStr), EndHash:DSHash(Stringify(obj)), Steps:steps}
}
func ReverseDelta(delta Delta) Delta {
    reversedSteps:=make([]DeltaStep,len(delta.Steps))
    for i,fstep:=range delta.Steps {
        rstep:=DeltaStep{Path:fstep.Path, Key:fstep.Key}
        switch fstep.Op {
            case "create":
                if fstep.Before!=nil { panic("Unexpected Before!") }
                if fstep.After==nil { panic("Missing After!") }
                rstep.Op,rstep.Before="delete",fstep.After
            case "update":
                if fstep.Before==nil { panic("Missing Before!") }
                if fstep.After==nil { panic("Missing After!") }
                rstep.Op,rstep.Before,rstep.After="update",fstep.After,fstep.Before
            case "delete":
                if fstep.After!=nil { panic("Unexpected After!") }
                if fstep.Before==nil { panic("Missing Before!") }
                rstep.Op,rstep.After="create",fstep.Before
            case "arrayInsert":
                if fstep.Before!=nil { panic("Unexpected Before!") }
                if fstep.After==nil {  panic("Missing After!") }
                rstep.Op,rstep.Before="arrayRemove",fstep.After
            case "arrayRemove":
                if fstep.Before==nil { panic("Missing Before!") }
                if fstep.After!=nil { panic("Unexpected After!") }
                rstep.Op,rstep.After="arrayInsert",fstep.Before
            default: panic("Illegal operation: "+fstep.Op)
        }
        reversedSteps[i]=rstep
    }
    return Delta{StartHash:delta.EndHash, EndHash:delta.StartHash, Steps:reversedSteps}
}
func ApplyDelta(obj interface{}, delta Delta) interface{} { return ApplyDeltaBB(obj,delta,false,false) }
func ApplyDeltaBB(obj interface{}, delta Delta, doNotCheckStartHash,doNotCheckEndHash bool) interface{} {
    // Note: 'obj' is modified.
    origObjStr:=Stringify(obj)
    if !doNotCheckStartHash && delta.StartHash!="" {
        if DSHash(origObjStr)!=delta.StartHash { panic("Wrong StartHash!") }
    }
    stepI:=int(0)
    defer func(){
        if e:=recover(); e!=nil {
            if stepI>0 {
                fmt.Fprintln(os.Stderr, "Delta application failed.  Rolling back...")
                ApplyDelta(obj, ReverseDelta(Delta{StartHash:delta.StartHash, Steps:delta.Steps[:stepI]}))
                if Stringify(obj)!=origObjStr { fmt.Fprintln(os.Stderr, "Rollback failed!") }
            }
            panic(e)
        }
    }()
    for stepI=range delta.Steps {
        step:=delta.Steps[stepI]
        if step.Key==nil { panic("nil key!") }
        target:=TargetV(reflect.ValueOf(obj), step.Path)
        switch step.Op {
        case "create","update","delete":
            V,has:=D(target).GetV(step.Key)
            if step.Before!=nil {
                if !has { panic(fmt.Sprintf("Not in target: %#v",step.Key)) }
                if Stringify(V.Interface())!=Stringify(step.Before) { panic("Before value did not match!") }
            } else {
                if has { panic(fmt.Sprintf("Unexpectedly in target: ",step.Key)) }
            }

            if step.After!=nil {
                D(target).Set(step.Key,DeepCopy(step.After))  // Use DeepCopy to avoid external mutation.
            } else {
                if has {
                    D(target).Del(step.Key)
                }
            }
        case "arrayInsert":
            if step.After==nil { panic("Undefined After!") }
            D(target).SliceInsert(step.Key,step.After)
        case "arrayRemove":
            if Stringify(D(target).GetOrPanic(step.Key))!=Stringify(step.Before) { panic("Slice Before value mismatch!") }
            D(target).SliceRemove(step.Key)
        default: panic("Illegal operation: "+step.Op)
        }
    }
    if !doNotCheckEndHash && delta.EndHash!="" {
        if DSHash(Stringify(obj))!=delta.EndHash { panic("Wrong EndHash!") }
    }
    return obj // For chaining...  (I'm not sure if this is actually useful in Go, i'm just porting the logic directly from JS.)
}



/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// This second section deals with higher-level "state" objects, which have Event capabilities.  Still no network requirements.
// Useful for UI patterns, even without network.
// Starting here, everything becomes asynchronous.
//

const ID_NOMATCH=""
type Listener struct {
    ID            string
    CB,CBCmp,Data interface{}
}
type Dispatcher struct { listeners []Listener }
func (d *Dispatcher) On(callback,cbCmp interface{}) { d.OnD(callback,cbCmp,nil) }  // Go doesn't allow the comparison of functions (because of compiler optimizations that re-use function definitions for closures), so the user should also provide a 'cbCmp' argument, which we will use for comparison.
func (d *Dispatcher) OnD(callback,cbCmp,data interface{}) { d.OnUniq(ID_NOMATCH,callback,cbCmp,data) }
func (d *Dispatcher) OnUniq(id string, callback,cbCmp,data interface{}) {
    // Enable registration of callback many times, but each ID will only be called once.
    d.OffUniq(id)
    d.listeners=append(d.listeners, Listener{ID:id, CB:callback, CBCmp:cbCmp, Data:data})
}
func (d *Dispatcher) IsOn(id string) bool {
    for _,l:=range d.listeners {
        if l.ID==id { return true }
    }
    return false
}
func (d *Dispatcher) Off(cbCmp interface{}) { d.OffD(cbCmp,nil) }  // Use the same 'cbCmp' that you used for On().
func (d *Dispatcher) OffD(cbCmp,data interface{}) {
    for i:=len(d.listeners)-1; i>=0; i-- {
        l:=d.listeners[i]
        if l.CBCmp==cbCmp && l.Data==data {
            d.listeners=append(d.listeners[:i], d.listeners[i+1:]...)
        }
    }
}
func (d *Dispatcher) OffUniq(id string) {
    if id==ID_NOMATCH { return }
    for i:=len(d.listeners)-1; i>=0; i-- {
        if d.listeners[i].ID==id {
            d.listeners=append(d.listeners[:i], d.listeners[i+1:]...)
        }
    }
}
func (d *Dispatcher) OffAll() { d.listeners=d.listeners[:0] }
func (d *Dispatcher) Fire(args ...interface{}) {
    argsV:=make([]reflect.Value,len(args)); for i:=range args { argsV[i]=reflect.ValueOf(args[i]) }
    for _,l:=range append([]Listener{}, d.listeners...) {  // Make a copy because listeners can be modified from the event handlers (like removal of one-shot handlers).
        largsV:=argsV; if l.Data!=nil { largsV=append(largsV,reflect.ValueOf(l.Data)) }
        dyn.CallV(l.CB, largsV...)
    }
}


type State struct {
    //sync.Mutex   /////////  This would cause deadlock.  Instead, always operate on states from a Soloroutine.
    Disp  *Dispatcher
    Data  interface{}
}
func NewState(data interface{}) *State {
    s:=&State{Disp:&Dispatcher{}}
    s.Reset(data)
    return s
}
func (s *State) On(callback,cbCmp interface{}) { s.OnD(callback,cbCmp,nil) }
func (s *State) OnD(callback,cbCmp,data interface{}) { s.Disp.OnD(callback,cbCmp,data) }
func (s *State) Off(cbCmp interface{}) { s.OffD(cbCmp,nil) }
func (s *State) OffD(cbCmp,data interface{}) { s.Disp.OffD(cbCmp,data) }
func (s *State) Reset(data interface{}) {
    //s.Lock(); defer s.Unlock()
    if data!=nil { s.Data=data
    } else { s.Data=make(map[string]interface{}) }
    s.Disp.Fire(s,"reset")
}
func (s *State) Edit(operations Operations) {
    //s.Lock(); defer s.Unlock()
    if len(operations)==0 { return }  // Skip noops.
    delta:=Edit(s.Data, operations)
    s.Disp.Fire(s,"delta",delta)
}
func (s *State) ApplyDelta(delta Delta) {
    //s.Lock(); defer s.Unlock()
    if len(delta.Steps)==0 { return }  // Skip noops.
    ApplyDelta(s.Data,delta)
    s.Disp.Fire(s,"delta",delta)
}



/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//
// Third Layer deals with groups of States.  This is where we begin to be aware of creation/deletion events and IDs.
// 


// You MUST only use Ready stuff from Soloroutine!  I don't have any locks to prevent data races -- I took them out because they were causing deadlock.
type ReadyCB func()
type readyListener struct { callback ReadyCB; ctime time.Time }
type readyItem struct {
    isReady    bool
    listeners  []readyListener
}
type ReadyT struct {  // Call it 'ReadyT' so the name doesn't conflict with the Ready() method when embedding.
    sync.Mutex
    readys    map[string]*readyItem
    notReadys map[string]*[]ReadyCB
}
func NewReady() *ReadyT { return &ReadyT{readys:make(map[string]*readyItem), notReadys:make(map[string]*[]ReadyCB)} }
func (R *ReadyT) getReady(name string) *readyItem {
    // Must lock from higher level.
    item,has:=R.readys[name]
    if !has { item=&readyItem{}; R.readys[name]=item }
    return item
}
func (R *ReadyT) getNotReady(name string) *[]ReadyCB {
    // Must lock from higher level.
    ls,has:=R.notReadys[name]
    if !has { ls=&[]ReadyCB{}; R.notReadys[name]=ls }
    return ls
}
func (R *ReadyT) NotReady(name string) {
    //R.Lock(); locked:=true; Unlock:=func(){ if locked { locked=false; R.Unlock() } }; defer Unlock()  //// Locking code kept for reference.
    r:=R.getReady(name)
    if r.isReady {
        r.isReady=false
        ls:=append([]ReadyCB{},*R.getNotReady(name)...)  // Make a copy because the list can change while we iterate.
        //Unlock()
        for _,l:=range ls { l() }
    }
}
func (R *ReadyT) Ready(name string) {
    r:=R.getReady(name)
    if !r.isReady {
        r.isReady=true
        for len(r.listeners)>0 {
            cb:=r.listeners[len(r.listeners)-1].callback; r.listeners=r.listeners[:len(r.listeners)-1]  // Pop before calling.
            cb()
        }
    }
}
func (R *ReadyT) OnReady(name string, callback ReadyCB) {
    r:=R.getReady(name)
    if r.isReady { callback(); return }
    r.listeners=append(r.listeners, readyListener{ callback:callback, ctime:time.Now() })
}
func (R *ReadyT) WaitReady(name string) {  // Synchronous
    ch:=make(chan bool)
    R.OnReady(name, func(){ ch<-true })
    <-ch
    close(ch)
}
func (R *ReadyT) OnNotReady(name string, callback ReadyCB, checkCurValue bool) {
    ls:=R.getNotReady(name)
    *ls=append(*ls,callback)
    if checkCurValue {
        if !R.getReady(name).isReady { callback() }
    }
}
func (R *ReadyT) OffNotReady(name string, callback ReadyCB) {
    ls:=R.getNotReady(name)
    for i:=len(*ls)-1; i>=0; i-- {
        panic("I can't compare callbacks, so how should i actually do this?  I need to see a real-life scenario.")
        //if (*ls)[i]==callback { *ls=append( (*ls)[:i], (*ls)[i+1:]... ) }
    }
}

// These DB implementations are extremely racey cuz they were designed for JS.  I am going to limit them to a single goroutine instead of filling them with locks.  (A naive lock-based implementation will be prone to deadlock due to the READY stuff, which really requires an async design.)

// Note, i could improve the performance of the initial "entry call" (no improvement for recursive calls) by converting the whole infrastructure to a async-callback thing.  Basically, i'd get rid of the central goroutine, and instead structure the thing so that it would use whatever goroutine calls it.  The lucky caller would suddenly become the master goroutine until all the work was processesed, then it would be free to go back to its normal life.  This would require a complete consistent structure thru all users.  It's a high price, but it would get me very close to native speeds, while supporting advanced cool stuff like bidirectional generators that are nearly as fast as a normal function call.
// Response to the above comment: I think the better solution is to keep the current Soloroutine design because it contains the complexity so well.  Instead, focus on improving the performance of Go Channels by avoiding goroutine-parking.  Async() already helps a lot, but more can be done.  As long as you avoid parking, performance is not bad!

var GSolo = solo.NewSoloroutine() // Global Soloroutine

type Debouncer struct {
    sync.Mutex
    fn             func()
    delay          time.Duration
    futureCallTime time.Time
    running        bool
}
func NewDebouncer(fn func(), delay time.Duration) *Debouncer { return &Debouncer{fn:fn, delay:delay} }
func (d *Debouncer) Call() {
    d.Lock(); defer d.Unlock()
    d.futureCallTime=time.Now().Add(d.delay)
    if !d.running {
        d.running=true
        go func() {
            defer d.Unlock()
            for {
                d.Lock()
                now:=time.Now()
                if now.Before(d.futureCallTime) {
                    d.Unlock()
                    time.Sleep(d.futureCallTime.Sub(now))
                    continue
                }
                break
            }
            d.running=false
            d.fn()
        }()
    }
}


func LOG_ERR(e interface{}) { fmt.Fprintln(os.Stderr, e) }

type DB interface {
    Solo() *solo.Soloroutine
    OnD(callback,data interface{})
    OffD(data interface{})
    Exists(id string, callback func(bool))
    ExistsB(id string, callback func(bool), doNotWaitReady bool)
    ListIDs(callback func([]string))
    GetState(id string, onSuccess func(*State,string), onError func(interface{}))
    GetStateAutocreate(id string, defaultData interface{}, onSuccess func(*State,string), onError func(interface{}))
    CreateState(id string, state *State, onSuccess func(*State,string), onError func(interface{}))
    CreateStateB(id string, state *State, onSuccess func(*State,string), onError func(interface{}), doNotWaitReady bool)
    DeleteState(id string, onSuccess func(*State,string), onError func(interface{}))
}

type RamDB struct {
    solo    *solo.Soloroutine
    states  map[string]*State
    ready   *ReadyT
    disp    *Dispatcher
}
func NewRamDB(solo *solo.Soloroutine, data interface{}) *RamDB {
    if solo==nil {solo=GSolo}
    db:=&RamDB{ solo:solo, states:make(map[string]*State), ready:NewReady(), disp:&Dispatcher{} }
    db.solo.Sync(func() {
        db.ready.NotReady("READY")
        db.importData(data)
        db.ready.OnReady("RamDB.importData", func(){ db.ready.Ready("READY") })
    })
    return db
}
func (db *RamDB) Solo() *solo.Soloroutine { return db.solo }
func (db *RamDB) importData(data interface{}) {
    db.solo.Sync(func(){
        if data==nil { db.ready.Ready("RamDB.importData"); return }
        dataV:=reflect.ValueOf(data); dataD:=D(dataV)
        db.ready.NotReady("RamDB.importData")
        create:=func(id string, state *State, next func(interface{},error)) {
            var out interface{}; out=nil; var err error; err=nil  // Don't make the mistake of initializing these to interface{}(nil) or error(nil) because then they won't really be nil.
            defer func() {
                e:=recover()  // Always catch panics.
                if err==nil && e!=nil {
                    switch E:=e.(type) {
                    case error: err=E
                    case string: err=errors.New(E)
                    default: err=fmt.Errorf("%#v",e)
                    }
                }
                next(out,err)
            }()
            db.CreateStateB(id, state,
                func(*State,string){next(nil,nil)},
                func(e interface{}){
                    fmt.Fprintln(os.Stderr, e)
                    next(nil,nil)  // Our JS ignores the error, so we do too.  I forgot why.
                },
                true)  // 'true' tells createState not to wait for READY, so we don't deadlock.
        }
        keys:=dataD.Keys(); steps:=make([]SlideFn,0,len(keys))
        for _,id:=range keys { steps=append(steps,SlideFn{fn:create, args:[]interface{}{id, dataD.GetOrPanic(id)}}) }
        SlideChain(steps, func([]interface{},error){ db.ready.Ready("RamDB.importData") })
    })
}
func (db *RamDB) exportData() (out map[string]*State) {
    db.solo.Sync(func() {
        out=make(map[string]*State,len(db.states))
        for k,v:=range db.states { out[k]=v }
    })
    return
}
func (db *RamDB) OnD(callback,data interface{}) {
    db.solo.Sync(func() {
        db.disp.OnD(callback,db,data)
    })
}
func (db *RamDB) OffD(data interface{}) {
    db.solo.Sync(func() {
        db.disp.OffD(db,data)
    })
}
func (db *RamDB) stateCallback(state *State, op string, data interface{}, id string) {
    db.solo.Sync(func() {
        db.disp.Fire(id,state,op,data)
    })
}
func (db *RamDB) Exists(id string, callback func(bool)) { db.ExistsB(id,callback,false) }
func (db *RamDB) ExistsB(id string, callback func(bool), doNotWaitReady bool) {
    db.solo.Async(nil, func() {
        afterReady:=func() {
            _,has:=db.states[id]
            if callback!=nil { callback(has) }
        }
        if doNotWaitReady { afterReady(); return }
        db.ready.OnReady("READY",afterReady)
    })
}
func (db *RamDB) ListIDs(callback func([]string)) {
    db.solo.Async(nil, func() {
        db.ready.OnReady("READY", func() {
            keys:=make([]string,0,len(db.states)); for k:=range db.states { keys=append(keys,k) }
            if callback!=nil { callback(keys) }
        })
    })
}
func (db *RamDB) GetState(id string, onSuccess func(*State,string), onError func(interface{})) {
    db.solo.Async(onError, func() {
        db.ready.OnReady("READY", func() {
            state,has:=db.states[id]
            if !has {
                if onError==nil { onError=LOG_ERR }
                onError(errors.New("State does not exist: "+id))
                return
            }
            if onSuccess!=nil { onSuccess(state,id) }
        })
    })
}
func (db *RamDB) GetStateAutocreate(id string, defaultData interface{}, onSuccess func(*State,string), onError func(interface{})) {
    db.GetState(id, onSuccess, func(e interface{}) {
        if err,ok:=e.(error); ok && err.Error()=="State does not exist: "+id {
            db.CreateState(id, NewState(defaultData), onSuccess, onError)
        } else {
            if onError==nil { onError=LOG_ERR }
            onError(e)
            return
        }
    })
}
func (db *RamDB) CreateState(id string, state *State, onSuccess func(*State,string), onError func(interface{})) { db.CreateStateB(id,state,onSuccess,onError,false) }
func (db *RamDB) CreateStateB(id string, state *State, onSuccess func(*State,string), onError func(interface{}), doNotWaitReady bool) {
    db.ExistsB(id, func(exists bool) {
        if exists {
            if onError==nil { onError=LOG_ERR }
            onError(errors.New("Already exists: "+id))
            return
        }
        if state==nil { state=NewState(nil) }
        db.states[id]=state
        state.OnD(db.stateCallback,db,id)
        if !doNotWaitReady { db.disp.Fire(id, state, "create") }  // Do not fire events during loads.
        if onSuccess!=nil { onSuccess(state, id) }
        return
    }, doNotWaitReady)
}
func (db *RamDB) DeleteState(id string, onSuccess func(*State,string), onError func(interface{})) {
    db.Exists(id, func(exists bool) {
        if !exists {
            if onError==nil { onError=LOG_ERR }
            onError(errors.New("Does not exist: "+id))
            return
        }
        state:=db.states[id]
        state.OffD(db,id)
        delete(db.states,id)
        db.disp.Fire(id, state, "delete")
        if onSuccess!=nil { onSuccess(state,id) }
    })
}

