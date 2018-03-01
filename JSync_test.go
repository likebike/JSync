package JSync

import (
    "seb"
    "testing"
    "fmt"
    "time"
    "sync"
)

var assert,zssert=seb.Assert,seb.Zssert
type T=testing.T

func TestA0(t *T) {
    for _,in:=range []string{
        `{"a":{"x":"6","y":4,"z":[5]},"b":[1,2,3]}`,
        `{"a":[1,2,"3"]}`,
        `{"endHash":"0x2289c69e","startHash":"0xb02841f6","steps":[{"after":{"x":24},"key":"b","op":"create","path":[]},{"after":3,"key":"c","op":"create","path":["b"]},{"after":[30],"before":3,"key":"c","op":"update","path":["b"]},{"before":1,"key":"a","op":"delete","path":[]},{"after":"item-0","key":0,"op":"arrayInsert","path":["b","c"]},{"before":30,"key":1,"op":"arrayRemove","path":["b","c"]}]}`,
        `[1,2,3,4]`,
        `["a",{"a":"a","c":3},"delete",null,null]`,
    } {
        out:=Stringify(Parse(in))
        assert(in==out, "Unequal Parse/Stringify:",in,"!=",out)
    }
    fmt.Println("Parse/Stringify OK")
}

func TestA1(t *T) {
    eq:=func(a,b string) { assert(a==b, a, "!=", b) }
    eq(Pad("va","E",3), "Eva")
    eq(Pad("Eva","Awesome",4), "AwesomeEva")
    eq(Pad(" Eva","♥",10), "♥♥♥♥♥♥ Eva")
    fmt.Println("Pad OK")
}

func TestA2(t *T) {
    id:=NewID()
    fmt.Println(id)
    assert(len(id)==8)
    DelID(id)
}

func TestA3(t *T) {
    eq:=func(a,b string) { assert(a==b, a, "!=", b) }
    eq(DSHash("Eva"), "0xe51a2ff8")
    eq(DSHash("黄哲"), "0x8c4234fa")
}

func TestA4(t *T) {
    data1:=struct {
        a struct {
            b byte
        }
    }{a:struct{b byte}{b:'c'}}
    result:=Target(data1,[]interface{}{"a","b"}).(byte)
    assert(result=='c', "expected:",'c', "got:",result)

    data2:=map[string]struct{b byte}{"a":struct{b byte}{b:'c'}}
    result=Target(data2,[]interface{}{"a","b"}).(byte)
    assert(result=='c', "expected:",'c', "got:",result)

    data3:=map[string][]byte{"a":[]byte{'c'}}
    result=Target(data3,[]interface{}{"a",0}).(byte)
    assert(result=='c', "expected:",'c', "got:",result)

    data4:=map[string]string{"a":"cat"}
    result=Target(data4,[]interface{}{"a",0}).(byte)
    assert(result=='c', "expected:",'c', "got:",result)
}

func TestA5(t *T) {
    data:=struct{a []interface{}}{a:[]interface{}{1,2,"3"}}
    expected:=`{"a":[1,2,"3"]}`
    result:=Stringify(DeepCopy(data))
    assert(result==expected, "expected:",expected, "got:",result)

    assert(DeepEqual(data,data))
}

func TestA6(test *T) {
    s:=make([]int,2,2); s[0],s[1]=0,1
    d:=Edit(&s, Operations{ {Op:"create", Path:nil, Key:2, Value:20 } })
    assert(Stringify(d)==`{"endHash":"0xa1cf69fb","startHash":"0x323bd0cf","steps":[{"after":20,"key":2,"op":"create","path":[]}]}` &&
           Stringify(s)==`[0,1,20]`, Stringify(d),Stringify(s))
    d=Edit(&s, Operations{ {Op:"update", Path:nil, Key:2, Value:30 } })
    assert(Stringify(d)==`{"endHash":"0x42f3536b","startHash":"0xa1cf69fb","steps":[{"after":30,"before":20,"key":2,"op":"update","path":[]}]}` &&
           Stringify(s)==`[0,1,30]`, Stringify(d),Stringify(s))
    d=Edit(&s, Operations{ {Op:"delete", Path:nil, Key:2 } })
    assert(Stringify(d)==`{"endHash":"0x323bd0cf","startHash":"0x42f3536b","steps":[{"before":30,"key":2,"op":"delete","path":[]}]}` &&
           Stringify(s)==`[0,1]`, Stringify(d),Stringify(s))
    d=Edit(&s, Operations{ {Op:"arrayPush", Path:nil, Value:40 } })
    assert(Stringify(d)==`{"endHash":"0x853b267a","startHash":"0x323bd0cf","steps":[{"after":40,"key":2,"op":"arrayInsert","path":[]}]}` &&
           Stringify(s)==`[0,1,40]`, Stringify(d),Stringify(s))
    d=Edit(&s, Operations{ {Op:"arrayInsert", Path:nil, Key:1, Value:5 } })
    assert(Stringify(d)==`{"endHash":"0x1aa037bf","startHash":"0x853b267a","steps":[{"after":5,"key":1,"op":"arrayInsert","path":[]}]}` &&
           Stringify(s)==`[0,5,1,40]`, Stringify(d),Stringify(s))
    d=Edit(&s, Operations{ {Op:"arrayPop", Path:nil } })
    assert(Stringify(d)==`{"endHash":"0x338a838e","startHash":"0x1aa037bf","steps":[{"before":40,"key":3,"op":"arrayRemove","path":[]}]}` &&
           Stringify(s)==`[0,5,1]`, Stringify(d),Stringify(s))
    d=Edit(&s, Operations{ {Op:"arrayRemove", Path:nil, Key:0 } })
    assert(Stringify(d)==`{"endHash":"0x8f9209a0","startHash":"0x338a838e","steps":[{"before":0,"key":0,"op":"arrayRemove","path":[]}]}` &&
           Stringify(s)==`[5,1]`, Stringify(d),Stringify(s))

    m:=make(map[string]int); m["a"],m["b"]=0,1
    d=Edit(m, Operations{ {Op:"create", Path:nil, Key:"c", Value:20 } })
    assert(Stringify(d)==`{"endHash":"0x3e19d6ef","startHash":"0x5bc2d078","steps":[{"after":20,"key":"c","op":"create","path":[]}]}` &&
           Stringify(m)==`{"a":0,"b":1,"c":20}`, Stringify(d),Stringify(m))
    d=Edit(m, Operations{ {Op:"update", Path:nil, Key:"c", Value:30 } })
    assert(Stringify(d)==`{"endHash":"0x7a622bf8","startHash":"0x3e19d6ef","steps":[{"after":30,"before":20,"key":"c","op":"update","path":[]}]}` &&
           Stringify(m)==`{"a":0,"b":1,"c":30}`, Stringify(d),Stringify(m))
    d=Edit(m, Operations{ {Op:"delete", Path:nil, Key:"c" } })
    assert(Stringify(d)==`{"endHash":"0x5bc2d078","startHash":"0x7a622bf8","steps":[{"before":30,"key":"c","op":"delete","path":[]}]}` &&
           Stringify(m)==`{"a":0,"b":1}`, Stringify(d),Stringify(m))

    t:=struct{a,b,c int}{a:0,b:1,c:2}
    d=Edit(&t, Operations{ {Op:"update", Path:nil, Key:"c", Value:30 } })
    assert(Stringify(d)==`{"endHash":"0x7a622bf8","startHash":"0xaa3ca07a","steps":[{"after":30,"before":2,"key":"c","op":"update","path":[]}]}` &&
           Stringify(t)==`{"a":0,"b":1,"c":30}`, Stringify(d),Stringify(t))
    //d=Edit(&t, Operations{ {Op:"delete", Path:nil, Key:"c" } })
    //assert(Stringify(d)==`{"endHash":"0x7a622bf8","startHash":"0xaa3ca07a","steps":[{"before":30,"key":"c","op":"delete","path":[]}]}` &&
    //       Stringify(t)==`{"a":0,"b":1}`, Stringify(d),Stringify(t))

    a:=[3]int{0,1,2}
    d=Edit(&a, Operations{ {Op:"update", Path:nil, Key:2, Value:30 } })
    assert(Stringify(d)==`{"endHash":"0x42f3536b","startHash":"0x749fd136","steps":[{"after":30,"before":2,"key":2,"op":"update","path":[]}]}` &&
           Stringify(a)==`[0,1,30]`, Stringify(d),Stringify(a))


    type M map[string]interface{}
    type L []interface{}
    obj:=M{"a":1}
    ops:=Operations{{Op:"create", Key:"b", Value:M{"x":24}},
                    {Op:"update!", Path:L{"b"}, Key:"c", Value:3},
                    {Op:"update", Path:L{"b"}, Key:"c", Value:&L{30}},
                    {Op:"delete", Key:"a"},
                    {Op:"arrayInsert", Path:L{"b","c"}, Key:0, Value:"item-0"},
                    {Op:"arrayRemove", Path:L{"b","c"}, Key:1}}
    delta:=Edit(obj, ops)
    assert(Stringify(delta)==`{"endHash":"0x2289c69e","startHash":"0xb02841f6","steps":[{"after":{"x":24},"key":"b","op":"create","path":[]},{"after":3,"key":"c","op":"create","path":["b"]},{"after":[30],"before":3,"key":"c","op":"update","path":["b"]},{"before":1,"key":"a","op":"delete","path":[]},{"after":"item-0","key":0,"op":"arrayInsert","path":["b","c"]},{"before":30,"key":1,"op":"arrayRemove","path":["b","c"]}]}`, "Big Edit Delta:",Stringify(delta));
    assert(Stringify(ReverseDelta(delta)), `{"endHash":"0xb02841f6","startHash":"0x2289c69e","steps":[{"after":30,"key":1,"op":"arrayInsert","path":["b","c"]},{"before":"item-0","key":0,"op":"arrayRemove","path":["b","c"]},{"after":1,"key":"a","op":"create","path":[]},{"after":3,"before":[30],"key":"c","op":"update","path":["b"]},{"before":3,"key":"c","op":"delete","path":["b"]},{"before":{"x":24},"key":"b","op":"delete","path":[]}]}`);

}

func TestB1(test *T) {
    d:=&Dispatcher{}
    out1:=0
    d.On(func(val int) { fmt.Println("cb1"); out1=val })
    d.Fire(123)
    assert(out1==123)
    d.On(func() { fmt.Println("cb2"); out1=456 })
    d.On(func(a,b,c int, d,e,f,g bool) { fmt.Println(a,b,c,d,e,f,g) })
    d.Fire(123)
    assert(out1==456, "out1:",out1)
}

func TestB2(test *T) {
    s:=NewState(map[string]int{"a":111})
    cbCount:=0
    cb:=func(state *State, etype string, edata Delta) { cbCount+=1 }
    s.On(cb)
    s.Edit(Operations{{Op:"create", Key:"b", Value:222}})
    assert(cbCount==1)
    assert(Stringify(s.Data)==`{"a":111,"b":222}`, Stringify(s.Data))
}

func TestB3(test *T) {
    r:=NewReady()
    r.OnReady("1", func(){ fmt.Println("ready 1") })
    r.Ready("1")
    r.Ready("2")
    r.OnReady("2", func(){ fmt.Println("ready 2") })
    r.OnReady("3", func(){ fmt.Println("ready 3") })
    time.Sleep(1*time.Second)
    r.Ready("3")
}



func TestC1(test *T) {
    u:=NewSoloroutine(); defer func(){ u.Stop(); time.Sleep(100*time.Millisecond); assert(u.stopped) }()
    u.Call(fmt.Println, "hello", "soloroutine")
    badFn:=func(){ panic("panic from soloroutine call") }
    func() {
        defer func() {
            if e:=recover(); e!=nil {
                fmt.Println("Recovered from panic.")
            } else {
                panic("I expected a panic!")
            }
        }()
        u.Call(badFn)
    }()
    ret:=u.Call(fmt.Sprintf, "%s %d", "abc", 123); retS:=ret[0].(string); fmt.Println(retS)

    var n int64
    inc:=func() { n++ }
    s:=time.Now(); for i:=0; i<100000; i++ { inc() }; fmt.Println("Direct: ", time.Since(s))
    s =time.Now(); for i:=0; i<100000; i++ { u.Call(inc) }; fmt.Println("Soloroutine.Call(): ", time.Since(s))
    s =time.Now(); for i:=0; i<100000; i++ { u.Call0(inc) }; fmt.Println("Soloroutine.Call0(): ", time.Since(s))
}

func TestC2(test *T) {
    gotChainResult:=false
    SlideChain([]SlideFn{
        {fn:func(a,b,c interface{}, next func(interface{},error)){ next(fmt.Sprintf("%#v %#v %#v",a,b,c),nil) }, args:[]interface{}{1,"2",'3'}},
    }, func(results []interface{}, err error){
        gotChainResult=true
        fmt.Println("Chain Result:", results, err)
    })
    assert(gotChainResult)
}

func TestC3(test *T) {
    db:=NewRamDB(nil, map[string]*State{
        "test1":nil,
    })
    db.Exists("test1", func(exists bool) { fmt.Println("test1 Exists result:", exists) })
    db.Exists("test2", func(exists bool) { fmt.Println("test2 Exists result:", exists) })
}






























// BenchmarkDirect-4       1000000000           2.76 ns/op
// BenchmarkCast-4         1000000000           2.83 ns/op
// BenchmarkEmbedVal-4     500000000            3.17 ns/op
// BenchmarkEmbedPtr-4     1000000000           2.79 ns/op
// BenchmarkInterface-4    500000000            4.07 ns/op


type A struct {
    X []int
    Y string
    Z int64
}
func (a *A) Inc() { a.Z++ }

type B *A

type C struct {
    A
}

type D struct {
    *A
}

type E interface {
    Inc()
}

func BenchmarkDirect(b *testing.B) {
    a:=&A{}
    for i:=0; i<b.N; i++ {
        a.Inc()
    }
    //fmt.Println(a)
}

//func BenchmarkDirect2(bench *testing.B) {
//    b:=&B{}
//    for i:=0; i<bench.N; i++ {
//        b.Inc()                            // Can't call b.Inc()
//    }
//}

func BenchmarkCast(bench *testing.B) {       // No runtime cost.
    b:=B(&A{})
    for i:=0; i<bench.N; i++ {
        (*A)(b).Inc()
    }
    //fmt.Println(b)
}

func BenchmarkEmbedVal(bench *testing.B) {   // This is some small cost to embedding.
    c:=&C{}
    for i:=0; i<bench.N; i++ {
        c.Inc()
    }
    //fmt.Println(c)
}

func BenchmarkEmbedPtr(bench *testing.B) {   // No runtime cost.
    d:=D{A:&A{}}
    for i:=0; i<bench.N; i++ {
        d.Inc()
    }
    //fmt.Println(d.A)
}

func BenchmarkInterface(bench *testing.B) {  // Even more cost for interfaces.
    var e E = &A{}
    for i:=0; i<bench.N; i++ {
        e.Inc()
    }
    //fmt.Println(d)
}





func TestZ1(test *T) {
    l:=sync.Mutex{}
    go func(){ time.Sleep(1*time.Second); l.Unlock() }()
    l.Lock()
    fmt.Println("past first lock.")
    l.Lock(); defer l.Unlock()
    fmt.Println("past second lock.")
}
func TestZ2(test *T) {
    ch:=make(chan bool)
    go func(){ time.Sleep(1*time.Second); ch<-true }()
    fmt.Println("Waiting for chan sig")
    <-ch
    fmt.Println("Got chan sig")
}






