package JSync

import (
    "fmt"
    "errors"
    "os"
    "time"
)

// I haven't implemented FileDB or DirDB yet -- I haven't needed them.

type OpHandler func(clientID string, data M, next func(result M))
type Receive struct {
    DataIsWaiting func(waitingCount int)
    Shutdown      func(hijacked bool)
}
type CometServer struct {
    LongPollTimeout,ConnectionStaleTime time.Duration
    DisposableQueueSizeLimit            int
    receives                            map[string]*Receive
    DB                                  DB
    OpHandlers                          map[string]OpHandler
}
func NewCometServer(db DB) (s *CometServer) {
    s=&CometServer{LongPollTimeout:100*time.Second, ConnectionStaleTime:5*time.Minute, DisposableQueueSizeLimit:200, receives:make(map[string]*Receive)}
    s.SetDB(db)
    s.InstallOpHandlers()
    s.runRemoveStaleClients()
    return s
}
func (s *CometServer) SetDB(db DB) {
    if db==nil { panic(errors.New("Null DB")) }
    if s.DB!=nil { panic(errors.New("DB replacement not implemented yet.")) }
    s.DB=db
    //s.DB.OnD(s.dbEventCallback,nil);  // For now, I don't actually have a need for these callbacks.
    // Define some states that definitely need to be there:
    s.DB.GetStateAutocreate("browsers",nil,nil,nil);
    s.DB.GetStateAutocreate("clients",nil,nil,nil);
}
func (s *CometServer) dbEventCallback(id string, state *State, op string, data interface{}) { fmt.Fprintln(os.Stderr, "CometServer dbEventCallback:",id,state,op,data) }
func (s *CometServer) SetOpHandler(name string, handler OpHandler) OpHandler {
    // NOTE: In the JS implementation, this function is just a pointer to CometClient.SetOpHandler().
    if name=="" { panic(errors.New("Missing name!")) }
    if s.OpHandlers==nil { s.OpHandlers=make(map[string]OpHandler) }
    if _,has:=s.OpHandlers[name]; has { panic(errors.New("OpHandler replacement not implemented yet.")) }
    s.OpHandlers[name]=handler
    return handler;  // For chaining.
}
func (s *CometServer) GetOpHandler(name string) OpHandler {
    h,has:=s.OpHandlers[name]
    if !has {
        h = func(clientID string, data M, next func(result M)) {
            fmt.Fprintln(os.Stderr, "Unknown OpHandler:", name)
            next(M{"op":"REPLY", "error":"Unknown Server OpHandler", "cbID":data["cbID"]})
        }
    }
    return h
}
func (s *CometServer) InstallOpHandlers() {
    s.SetOpHandler("echoImmediate", func(clientID string, data M, reply func(M)) {
        data["op"]="REPLY"
        reply(data)
    })
    s.SetOpHandler("echo", func(clientID string, data M, reply func(M)) {
        data["op"]="REPLY"
        reply(nil)  // Send an Immediate blank reply.
        reply(data) // Send a Delayed reply.
    })
}
type BrowserInfoT struct { BrowserID string; Clients map[string]bool }
func (s *CometServer) BrowserInfo(browserID string, callback func(*BrowserInfoT)) {
    if browserID=="" { callback(nil); return }
    s.DB.GetState("browsers", func(browsers *State, _ string) {
        infoInterface,has:=GOf(browsers.Data).Get(browserID)
        if !has { callback(nil); return }
        info:=DeepCopy(infoInterface).(BrowserInfoT)  // Prevent external mutation.
        info.BrowserID=browserID
        info.Clients=map[string]bool{}
        s.DB.GetState("clients", func(clients *State, _ string) {
            clientsDataG:=GOf(clients.Data)
            for _,clientID:=range clientsDataG.Keys() {
                if clientsDataG.GetGOrPanic(clientID).GetDefault("browserID",nil)==browserID { info.Clients[clientID.(string)]=true }
            }
            callback(&info)
        }, nil)
    }, nil)
}
type ClientInfoT struct { BrowserID,ClientID string }
func (s *CometServer) ClientInfoSync(clientID string, clientsState *State) *ClientInfoT {
    if clientID=="" { return nil }
    c,has:=GOf(clientsState.Data).GetG(clientID); if !has { return nil }
    info:=ClientInfoT{BrowserID:c.GetOrPanic("browserID").(string), ClientID:clientID}
    // In the future, I might also want to fetch the 'browsers' state and inclue some info from there, but right now, it's just blank objects.
    // Might also want to include a list of other clientIDs that have the same browserID...
    return &info
}
func (s *CometServer) ClientInfo(clientID string, callback func(*ClientInfoT)) {
    s.DB.GetState("clients", func(clients *State, _ string) { if callback!=nil { callback(s.ClientInfoSync(clientID,clients)) } }, nil)
}
type ClientState struct {
    BrowserID string
    ReceiveQ  []M
}
func (s *CometServer) ClientConnect(browserID,requestedClientID string, onSuccess func(ClientInfoT), onError func(interface{})) {
    s.DB.GetState("clients", func(clients *State, _ string) {
        clientID:=func() string {
            if requestedClientID=="" { return "" }
            if !ID_REGEX.MatchString(requestedClientID) { return "" }
            cInfo:=s.ClientInfoSync(requestedClientID,clients)
            if cInfo==nil { return "" }
            if cInfo.BrowserID!=browserID { return "" }
            return requestedClientID
        }()
        if clientID=="" { clientID=_newID(-1,clients.Data) }
        if rcv,has:=s.receives[clientID]; has { rcv.Shutdown(true) }  // Check for an existing connection with the same clientID and hijack it ('true').
        fmt.Fprintln(os.Stderr, "Connected: browserID="+browserID, "clientID="+clientID)
        if _,has:=GOf(clients.Data).GetV(clientID); !has { clients.Edit(Operations{ {Op:"create", Key:clientID, Value:ClientState{BrowserID:browserID}} }) }
        s.touchClient(clientID, func(){onSuccess(ClientInfoT{BrowserID:browserID,ClientID:clientID})}, onError)
    }, onError)
}
func (s *CometServer) ClientDisconnect(clientID string, onSuccess func(), onError func(interface{})) {
    s.DB.GetState("clients", func(clients *State, _ string) {
        if _,has:=GOf(clients.Data).GetV(clientID); !has {
            if onError==nil { onError=LOG_ERR }
            onError(errors.New("clientID not found: "+clientID))
            return
        }
        s.removeClient(clients, clientID)
        if onSuccess!=nil { onSuccess() }
    }, onError)
}
func (s *CometServer) removeClient(clientsState *State, clientID string) {
    if rcv,has:=s.receives[clientID]; has { rcv.Shutdown(false) }  // Shutdown() will remove the entry from 'receives'.
    if _,has:=s.receives[clientID]; has { fmt.Fprintln(os.Stderr, "CometServer shutdown(0 did not remove receives[clientID] !") }
    clientsState.Edit(Operations{ {Op:"delete", Key:clientID} })
}
func (s *CometServer) runRemoveStaleClients() {
    panic("TODO")
}
func (s *CometServer) removeStaleClients() {
    s.DB.GetState("clients", func(clients *State, _ string) {
        curTime:=time.Now()
        for _,clientID:=range GOf(clients.Data).Keys() {
            if curTime.Sub(GOf(clients.Data).GetGOrPanic(clientID).GetOrPanic("Atime").(time.Time)) > s.ConnectionStaleTime {
                fmt.Fprintln(os.Stderr, "Removing Stale Client:", clientID)
                s.removeClient(clients, clientID.(string))
            }
        }
    }, nil)
}
func (s *CometServer) touchClient(clientID string, onSuccess func(), onError func(interface{})) {
    s.DB.GetState("clients", func(clients *State, _ string) {
        now:=time.Now()
        clients.Edit(Operations{ {Op:"update!", Path:[]interface{}{clientID}, Key:"Atime", Value:now } })
        s.DB.GetState("browsers", func(browsers *State, _ string) {
            browsers.Edit(Operations{ {Op:"update!", Path:[]interface{}{GOf(clients.Data).GetOrPanic("browserID")}, Key:"Atime", Value:now} })
            if onSuccess!=nil { onSuccess() }
        }, onError)
    }, onError)
}
func (s *CometServer) ClientSend(clientID string, bundle []M, onSuccess func([]M), onError func(interface{})) {
    s.touchClient(clientID,nil,nil)
    fn:=func(bundleItem M, next func(error,M)) {
        // We provide opHandlers with this 'reply' function.  Call it up to twice: Once as an Immediate (usually undefined) reply, or a second time for a Delayed reply.
        replied,callNum:=false,0
        reply:=func(result M) {
            callNum++
            if callNum>2 { panic(errors.New("Too many reply() calls!")) }
            if replied { panic(errors.New("Already replied@")) }
            if callNum==1 && result==nil {
                // Blank Immediate result.
                next(nil, nil)
            } else if callNum==1 && result!=nil {
                // Immediate result
                replied=true
                next(nil, M{"op":"REPLY", "cbID":bundleItem["cbID"]}.Extend(result))
            } else if callNum==2 && result==nil {
                panic(errors.New("Falsey Delayed reply!"))
            } else if callNum==2 && result!=nil {
                // Delayed result
                replied=true
                s.AddToReceiveQ(clientID, M{"op":"REPLY", "cbID":bundleItem["cbID"]}.Extend(result))
            } else { panic(errors.New("This should never happen.")) }
        }
        handler:=s.GetOpHandler(bundleItem["op"].(string))
        s.DB.Solo().SetTimeout(func(){ handler(clientID,bundleItem,reply) }, 0)  // We use this 'SetTimeout()' to accomplish two things:  1) Prevent stack overflow (actually not an issue for Go), and prevent one client from hogging the server.  2) Guarantee correct order of operations, regardless of the async implementation of the handlers.  Without this timeout, it's easy for operations to become reversed depending on whether an async function is really asynchronous or whether it's synchronous with and async interface.
    }
    chain:=make([]SlideFn,len(bundle))
    for _,bundleItem:=range bundle { chain=append(chain, SlideFn{fn:fn, args:[]interface{}{bundleItem}}) }
    SlideChain(chain, func(results []interface{}, err error) {
        if err!=nil { panic(errors.New("I have never seen this.")) }
        var out []M
        for _,r:=range results {
            if r==nil { continue }
            out=append(out,r.(M))
        }
        if onSuccess!=nil { onSuccess(out) }
    })
}
func (s *CometServer) AddToReceiveQ(clientID string, data M) {
    s.DB.GetState("clients", func(clients *State, _ string) {
        c,has:=GOf(clients.Data).Get(clientID);  C:=c.(ClientState)
        if !has { return }  // The client disconnected while we were sending data to them.  Discard the data.
        if data["_disposable"]==true {
            // This data is disposable.  Throw it out if the queue is already too long:
            if len(C.ReceiveQ) > s.DisposableQueueSizeLimit { return }
            delete(data, "_disposable")  // Save some bandwidth.
        }
        clients.Edit(Operations{ {Op:"arrayPush", Path:[]interface{}{clientID, "receiveQ"}, Value:data} })
        if rcv,has:=s.receives[clientID]; has { rcv.DataIsWaiting(len(C.ReceiveQ)) }
    }, nil)
}
func Broadcast_includeAll(clientID string, data M, cb func(bool)) { cb(true) }  // So I don't need to re-invent this everywhere.
func (s *CometServer) Broadast(excludeConnIDs []string, shouldIncludeFunc func(clientID string, data M, cb func(bool)), data M) {
    excludeMap:=make(map[string]bool, len(excludeConnIDs)); for _,id:=range excludeConnIDs { excludeMap[id]=true }
    s.DB.GetState("clients", func(clients *State, _ string) {
        GOf(clients.Data).Each(func(clientIDI,_ interface{}) {
            clientID:=clientIDI.(string)
            if excludeMap[clientID] { return }
            shouldIncludeFunc(clientID, data, func(shouldInclude bool) {
                if shouldInclude { s.AddToReceiveQ(clientID,data) }
            })
        })
    }, nil)
}
type ClientIDWasHijacked struct {}
func (e ClientIDWasHijacked) Error() string { return "clientID was hijacked!" }
func (e ClientIDWasHijacked) StatusCode() int { return 452 }
func (s *CometServer) ClientReceive(clientID string, onSuccess func([]M), onError func(interface{})) {
    s.touchClient(clientID,nil,nil)

    // First, does a long poll already exist for this clientID?  If so, kill the old one before proceeding:
    if rcv,has:=s.receives[clientID]; has { rcv.Shutdown(false) }

    var out []M; myObj:=&Receive{}
    s.receives[clientID]=myObj
    myObj.Shutdown = func(hijacked bool) {
        r:=s.receives[clientID]
        if r!=myObj { // The connection was already shut down.
            if len(out)>0 { panic(errors.New("Connection is already shutdown, but output is still in queue!  This should never happen.")) }
            return
        }
        delete(s.receives,clientID)
        myOut:=out
        out=nil  // So subsequent shutdown() calls don't freak out about data in 'out'.
        if hijacked {
            onError(ClientIDWasHijacked{})
            return
        }
        onSuccess(myOut)
    }
    send := func() {
        s.DB.GetState("clients", func(clients *State, _ string) {
            if s.receives[clientID]!=myObj { return }  // The connection was already shut down.
            c,has:=GOf(clients.Data).Get(clientID)
            if !has { myObj.Shutdown(false); return }  // The client disconnected.  There's no point to send any data.  (Also, it would cause a "Path now found" exception in the edit() below.)  Just shut down the socket and stuff like that.
            out=c.(ClientState).ReceiveQ
            clients.Edit(Operations{ {Op:"update", Path:[]interface{}{clientID}, Key:"ReceiveQ", Value:nil} })
            myObj.Shutdown(false)
        }, onError)
    }
    debounced_send:=NewDebouncer(send, 4*time.Millisecond)
    myObj.DataIsWaiting = func(waitingCount int) {
        if waitingCount>100 {
fmt.Fprintln(os.Stderr, "Forcing send due to waitingCount")
            send()
            return
        }
        debounced_send.Call()
    }

    s.DB.Solo().SetTimeout(func(){myObj.Shutdown(false)}, s.LongPollTimeout)

    // Finally, if there is data already waiting, initiate the process:
    s.DB.GetState("clients", func(clients *State, _ string) {
        curLen:=len(GOf(clients.Data).GetOrPanic(clientID).(ClientState).ReceiveQ)
        if curLen>0 { myObj.DataIsWaiting(curLen) }
    }, onError)
}




