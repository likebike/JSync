package JSync

import (
    "seb/dyn"
    sebHttp "seb/http"
    "fmt"
    "errors"
    "os"
    "time"
    "net/http"
)
var DOf=dyn.DOf

// I haven't implemented FileDB or DirDB yet -- I haven't needed them.



func setCorsHeaders(req *http.Request, res http.ResponseWriter, options HttpInstallOptions) {
    res.Header().Set("Access-Control-Allow-Origin", func() string {
        if o:=options.AccessControlAllowOrigin; o!="" { return o }
        if o:=req.Header.Get("Origin"); o!="" { return o }
        if r:=req.Header.Get("Referer"); r!="" { return r }
        return "*"   // '*' isn't actually compatible with Access-Control-Allow-Credentials.
    }())   // Allow cross-domain requests.  ...otherwise javascript can't see the status code (it sees 0 instead because it is not allows to see any data that is not granted access via CORS).   ///// NOTE 2015-08-01: Client requests do not contain the 'Origin' header because they are not cross-domain requests.  I am adding 'Referer' as another option.
    res.Header().Set("Access-Control-Allow-Credentials", "true")   // Allow cross-domain cookies.  ...otherwise, javascript can't access the response body.
}
func setJsonResponseHeaders(res http.ResponseWriter) {
    res.Header().Set("Content-Type","application/json")
    res.Header().Set("Cache-Control","no-cache, must-revalidate")
}



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

    go func() {  // I'm putting this function inline instead of as a method because if it's a method, it implies that it might be called more than once, and then I'd need a tracking variable to tell me if it's running or not.  This structure defines that it's only run once.
        for {
            time.Sleep(10*time.Second)
            s.removeStaleClients()
        }
    }()

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
type BrowserState struct {
    Atime     time.Time
}
type BrowserInfo struct {
    BrowserID string
    Clients   map[string]bool
}
func (s *CometServer) BrowserInfo(browserID string, callback func(*BrowserInfo)) {
    if browserID=="" { callback(nil); return }
    s.DB.GetState("browsers", func(browsers *State, _ string) {
        _,has:=DOf(browsers.Data).Get(browserID)
        if !has { callback(nil); return }
        info:=BrowserInfo{BrowserID:browserID, Clients:make(map[string]bool)}
        s.DB.GetState("clients", func(clients *State, _ string) {
            clientsDataD:=DOf(clients.Data)
            for _,clientID:=range clientsDataD.Keys() {
                if clientsDataD.GetOrPanic(clientID).(*ClientState).BrowserID==browserID { info.Clients[clientID.(string)]=true }
            }
            callback(&info)
        }, nil)
    }, nil)
}
type ClientState struct {
    BrowserID string
    ReceiveQ  []M
    Atime     time.Time
}
type ClientInfo struct {
    BrowserID string `json:"browserID"`
    ClientID  string `json:"clientID"`
}
func (s *CometServer) ClientInfoSync(clientID string, clientsState *State) *ClientInfo {
    if clientID=="" { return nil }
    c,has:=DOf(clientsState.Data).GetD(clientID); if !has { return nil }
    info:=ClientInfo{BrowserID:c.Deref().GetOrPanic("BrowserID").(string), ClientID:clientID}
    // In the future, I might also want to fetch the 'browsers' state and inclue some info from there, but right now, it's just blank objects.
    // Might also want to include a list of other clientIDs that have the same browserID...
    return &info
}
func (s *CometServer) ClientInfo(clientID string, callback func(*ClientInfo)) {
    s.DB.GetState("clients", func(clients *State, _ string) { if callback!=nil { callback(s.ClientInfoSync(clientID,clients)) } }, nil)
}
func (s *CometServer) ClientConnect(browserID,requestedClientID string, onSuccess func(ClientInfo), onError func(interface{})) {
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
        if rcv,has:=s.receives[clientID]; has { rcv.Shutdown(true) }  // Check for an existing connection with the same clientID and hijack it ('true').  'true' means that we are hijacking the previous connection, causing existing connections to be shut down and forcing existing clients to re-connect with a different clientID.
        fmt.Fprintln(os.Stderr, "Connected: browserID="+browserID, "clientID="+clientID)
        if _,has:=DOf(clients.Data).GetV(clientID); !has { clients.Edit(Operations{ {Op:"create", Key:clientID, Value:&ClientState{BrowserID:browserID}} }) }
        s.touchClient(clientID, func(){onSuccess(ClientInfo{BrowserID:browserID,ClientID:clientID})}, onError)
    }, onError)
}
func (s *CometServer) ClientDisconnect(clientID string, onSuccess func(), onError func(interface{})) {
    s.DB.GetState("clients", func(clients *State, _ string) {
        if _,has:=DOf(clients.Data).GetV(clientID); !has {
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
func (s *CometServer) removeStaleClients() {
    s.DB.GetState("clients", func(clients *State, _ string) {
        curTime:=time.Now()
        for _,clientID:=range DOf(clients.Data).Keys() {
            if curTime.Sub(DOf(clients.Data).GetDOrPanic(clientID).Deref().GetOrPanic("Atime").(time.Time)) > s.ConnectionStaleTime {
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
            browsers.Edit(Operations{ {Op:"update!", Path:[]interface{}{DOf(clients.Data).GetOrPanic(clientID).(*ClientState).BrowserID}, Key:"Atime", Value:now} })
            if onSuccess!=nil { onSuccess() }
        }, onError)
    }, onError)
}
func (s *CometServer) ClientSend(clientID string, bundle []M, onSuccess func([]M), onError func(interface{})) {
    s.touchClient(clientID,nil,nil)
    fn:=func(bundleItem M, next SlideNext) {
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
                next(M{"op":"REPLY", "cbID":bundleItem["cbID"]}.Extend(result), nil)
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
    chain:=make([]SlideFn,0,len(bundle))
    for _,bundleItem:=range bundle { chain=append(chain, SlideFn{fn:fn, args:[]interface{}{bundleItem}}) }
    SlideChain(chain, func(results []interface{}, err error) {
        if err!=nil { panic(errors.New("I have never seen this.")) }
        out:=make([]M,0,len(results))
        for _,r:=range results {
            if r==nil { continue }
            out=append(out,r.(M))
        }
        if onSuccess!=nil { onSuccess(out) }
    })
}
func (s *CometServer) AddToReceiveQ(clientID string, data M) {
    s.DB.GetState("clients", func(clients *State, _ string) {
        c,has:=DOf(clients.Data).Get(clientID);  C:=c.(*ClientState)
        if !has { return }  // The client disconnected while we were sending data to them.  Discard the data.
        if data["_disposable"]==true {
            // This data is disposable.  Throw it out if the queue is already too long:
            if len(C.ReceiveQ) > s.DisposableQueueSizeLimit { return }
            delete(data, "_disposable")  // Save some bandwidth.
        }
        clients.Edit(Operations{ {Op:"arrayPush", Path:[]interface{}{clientID, "ReceiveQ"}, Value:data} })
        if rcv,has:=s.receives[clientID]; has { rcv.DataIsWaiting(len(C.ReceiveQ)) }
    }, nil)
}
func Broadcast_includeAll(clientID string, data M, cb func(bool)) { cb(true) }  // So I don't need to re-invent this everywhere.
func (s *CometServer) Broadast(excludeConnIDs []string, shouldIncludeFunc func(clientID string, data M, cb func(bool)), data M) {
    excludeMap:=make(map[string]bool, len(excludeConnIDs)); for _,id:=range excludeConnIDs { excludeMap[id]=true }
    s.DB.GetState("clients", func(clients *State, _ string) {
        DOf(clients.Data).Each(func(clientIDI,_ interface{}) {
            clientID:=clientIDI.(string)
            if excludeMap[clientID] { return }
            shouldIncludeFunc(clientID, data, func(shouldInclude bool) {
                if shouldInclude { s.AddToReceiveQ(clientID,data) }
            })
        })
    }, nil)
}
type ErrorWithStatusCode struct {                              //           /--- This 'onError'
    Err        string                                          //           |    must handle
    StatusCode int                                             //           |    ErrorWithStatusCode
}                                                              //           |    errors specially.
func (e ErrorWithStatusCode) Error() string { return e.Err }   //           v
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
        myOut:=out; if myOut==nil { myOut=make([]M,0) }  // Don't pass 'nil' to onSuccess to avoid 'null' JSON results.
        out=nil  // So subsequent shutdown() calls don't freak out about data in 'out'.
        if hijacked {
            onError(ErrorWithStatusCode{"clientID was hijacked!", 452})
            return
        }
        onSuccess(myOut)
    }
    send := func() {
        s.DB.GetState("clients", func(clients *State, _ string) {
            if s.receives[clientID]!=myObj { return }  // The connection was already shut down.
            c,has:=DOf(clients.Data).Get(clientID)
            if !has { myObj.Shutdown(false); return }  // The client disconnected.  There's no point to send any data.  (Also, it would cause a "Path now found" exception in the edit() below.)  Just shut down the socket and stuff like that.
            out=c.(*ClientState).ReceiveQ
            clients.Edit(Operations{ {Op:"update", Path:[]interface{}{clientID}, Key:"ReceiveQ", Value:make([]M,0,4)} })
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
        curLen:=len(DOf(clients.Data).GetOrPanic(clientID).(*ClientState).ReceiveQ)
        if curLen>0 { myObj.DataIsWaiting(curLen) }
    }, onError)
}



type HttpInstallOptions struct {
    CookieSecret             string
    AccessControlAllowOrigin string
}
func InstallCometServerIntoHttpMux(comet *CometServer, mux *http.ServeMux, baseURL string, options HttpInstallOptions) {
    if baseURL=="" { panic(errors.New("Empty baseURL!")) }
    if baseURL[0]!='/' { panic(errors.New("baseURL should start with '/'.")) }
    if baseURL[len(baseURL)-1]=='/' { panic(errors.New("baseURL should not end with '/'.")) }
    connect:=sebHttp.SoloroutineAsyncHandler{Solo:comet.DB.Solo(), Next:HttpHandler_connect(comet, options)}
    mux.Handle(baseURL+"/connect",    connect)
    mux.Handle(baseURL+"/disconnect", connect)
    mux.Handle(baseURL+"/send",       sebHttp.SoloroutineAsyncHandler{Solo:comet.DB.Solo(), Next:HttpHandler_send(comet, options)})
    mux.Handle(baseURL+"/receive",    sebHttp.SoloroutineAsyncHandler{Solo:comet.DB.Solo(), Next:HttpHandler_receive(comet, options)})
}
func HttpHandler_connect(comet *CometServer, options HttpInstallOptions) func(http.ResponseWriter, *http.Request, func(), func(interface{})) {
    if options.CookieSecret=="" { panic("You must define options.CookieSecret!") }
    return func(res http.ResponseWriter, req *http.Request, onSuccess func(), onError func(interface{})) {
        setCorsHeaders(req, res, options)
        afterWeHaveABrowserID:=func(browserID string) {
            if err:=req.ParseForm(); err!=nil { onError(err); return }
            opArray:=req.Form["op"]
            if len(opArray)!=1 { onError(errors.New("Wrong number of ops!")); return }
            clientIdArray:=req.Form["clientID"]; if len(clientIdArray)==0 { clientIdArray=req.Form["_clientID"] }  // '_clientID' is used by 'connect' to prevent 'ajax()' from waiting for connection.
            if len(clientIdArray)!=1 { onError(errors.New("Wrong number of clientIDs!")); return }
            clientID:=clientIdArray[0]
            switch(opArray[0]) {
            case "connect":
                comet.ClientConnect(browserID, clientID, func(clientInfo ClientInfo) {
                    setJsonResponseHeaders(res)
                    res.Write([]byte(Stringify(clientInfo)))
                    onSuccess()
                }, onError)
            case "disconnect":
                fmt.Fprintln(os.Stderr, "Disconnected: browserID="+browserID, "clientID="+clientID)
                comet.BrowserInfo(browserID, func(browserInfo *BrowserInfo) {
                    if browserInfo==nil { onError(errors.New("Disconnect: browserID not found (weird!): "+browserID)); return }  // This would be weird, since we *just* validate the browserID...
                    if _,has:=browserInfo.Clients[clientID]; !has { onError(errors.New("Disconnect: Wrong browserID, or expired client.")); return }
                    comet.ClientDisconnect(clientID, func() {
                        setJsonResponseHeaders(res)
                        res.Write([]byte("{}"))
                        onSuccess()
                    }, onError)
                })
            default:
                onError(errors.New("Invalid op!"))
                return
            }
        }
        comet.DB.GetState("browsers", func(browsers *State, _ string) {
            browserID:="0000"
            func() {
                defer func(){recover()}()  // "defer recover()"  doesn't work.
                browsers.Edit(Operations{ {Op:"create", Key:browserID, Value:&BrowserState{}} })
            }()
            afterWeHaveABrowserID(browserID)
        }, onError)
    }
}
func WriteHeader(res http.ResponseWriter, code int) {
    res.WriteHeader(code)
    if F,ok:=res.(http.Flusher); ok { F.Flush()
    } else { fmt.Fprintln(os.Stderr, "Warning: ResponseWriter is not a Flusher.  Responses might not be sent properly.") }
}
func JSyncHttpAuth(comet *CometServer, options HttpInstallOptions, next func(string,string,http.ResponseWriter,*http.Request,func(),func(interface{}))) func(http.ResponseWriter,*http.Request,func(),func(interface{})) {
    return func(res http.ResponseWriter, req *http.Request, onSuccess func(), onError func(interface{})) {
        setCorsHeaders(req, res, options)
        if err:=req.ParseForm(); err!=nil { onError(err); return }
        clientIdArray:=req.Form["clientID"]
        if len(clientIdArray)!=1 { onError(errors.New("Wrong number of clientIDs!")); return }
        clientID:=clientIdArray[0]
        browserID:="0000"
        comet.BrowserInfo(browserID, func(browserInfo *BrowserInfo) {
            if browserInfo==nil {
                // This occurs when a client IP address changes, or if a cookie gets hijacked.  The user should log back in and re-authenticate.
                WriteHeader(res, 450)
                //onError(errors.New("Unknown browserID: "+browserID))  // JS version
                fmt.Fprintln(os.Stderr, "Unknown browserID: "+browserID); onSuccess()  // Go version
                return
            }
            // Now that browserID is checked, make sure the clientID matches:
            if _,has:=browserInfo.Clients[clientID]; !has {
                // This occurs when a client goes to sleep for a long time and then wakes up again (after their stale connection has already been cleared).  It is safe to allow the user to connect() again and resume where they left off.
                WriteHeader(res, 451)
                // onError(errors.New("Unknown clientID: "+clientID))  // JS version
                fmt.Fprintln(os.Stderr, "Unknown clientID: "+clientID); onSuccess()  // Go version
                return
            }

            // Not that status code 452 (client hijacked) is managed by the ClientRecieve Shutdown() function.

            // Authentication complete.  Continue on to the next step:
            next(browserID, clientID, res, req, onSuccess, onError)
        })
    }
}
func HttpHandler_send(comet *CometServer, options HttpInstallOptions) func(http.ResponseWriter, *http.Request, func(), func(interface{})) {
    return JSyncHttpAuth(comet, options, func(browserID,clientID string, res http.ResponseWriter, req *http.Request, onSuccess func(), onError func(interface{})) {
        bundleArray:=req.Form["bundle"]
        if len(bundleArray)!=1 { onError(errors.New("Wrong Bundle Length!")); return }
        bundleStr:=bundleArray[0]
        if bundleStr=="" { onError(errors.New("Blank Bundle!")); return }
        if bundleStr[0]!='[' || bundleStr[len(bundleStr)-1]!=']' { onError(errors.New("Bundle missing [] chars!")); return }
        bundle:=make([]M,0,4); Parse(bundleStr,&bundle)
        comet.ClientSend(clientID, bundle, func(result []M) {
            setJsonResponseHeaders(res)
            res.Write([]byte(Stringify(result)))
            onSuccess()
        }, onError)
    })
}
func HttpHandler_receive(comet *CometServer, options HttpInstallOptions) func(http.ResponseWriter, *http.Request, func(), func(interface{})) {
    return JSyncHttpAuth(comet, options, func(browserID,clientID string, res http.ResponseWriter, req *http.Request, onSuccess func(), onError func(interface{})) {
        comet.ClientReceive(clientID, func(result []M) {
            setJsonResponseHeaders(res)
            res.Write([]byte(Stringify(result)))
            onSuccess()
        }, func(e interface{}) {
            if err,ok:=e.(ErrorWithStatusCode); ok { WriteHeader(res, err.StatusCode) }
            // onError(e)  // JS version
            fmt.Fprintln(os.Stderr, "JSyncHttpAuth Error:", e); onSuccess() // Go version
        })
    })
}




