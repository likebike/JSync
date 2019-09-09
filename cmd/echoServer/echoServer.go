package main

import (
    "JSync"
    "seb/dyn"
    "fmt"
    "net/http"
    "os"
    "path/filepath"
    "time"
)

func main() {
    myDir,err:=filepath.Abs(filepath.Dir(os.Args[0])); if err!=nil { panic(err) }
    wwwDir:=filepath.Join(myDir,"www")
    mux:=http.NewServeMux()
    mux.Handle("/", http.FileServer(http.Dir(wwwDir)))
    comet:=JSync.NewCometServer(JSync.NewRamDB(JSync.GSolo, dyn.D{}))
    JSync.InstallCometServerIntoHttpMux(comet, mux, "/rt", JSync.HttpInstallOptions{CookieSecret:"♥ Gabriella ♥"})
    cometDB:=JSync.NewCometDBServer(comet, JSync.NewRamDB(JSync.GSolo, dyn.DOf(JSync.M{"s":dyn.NewD(JSync.NewState(dyn.DOf(JSync.M{"s1":dyn.NewD("S1")})))})), JSync.AccessPolicy_WideOpen)
    go func(){
        for {
            time.Sleep(10*time.Second)
            fmt.Fprintln(os.Stderr, JSync.Stringify(cometDB.DB.(*JSync.RamDB).states))
        }
    }()


    bind:=":4040"
    fmt.Println("Serving",wwwDir,"on",bind)
    http.ListenAndServe(bind, mux)
}

