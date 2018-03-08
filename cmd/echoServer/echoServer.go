package main

import (
    "JSync"
    "fmt"
    "net/http"
    "os"
    "path/filepath"
)

func main() {
    myDir,err:=filepath.Abs(filepath.Dir(os.Args[0])); if err!=nil { panic(err) }
    wwwDir:=filepath.Join(myDir,"www")
    mux:=http.NewServeMux()
    mux.Handle("/", http.FileServer(http.Dir(wwwDir)))
    comet:=JSync.NewCometServer(JSync.NewRamDB(JSync.GSolo, nil))
    JSync.InstallCometServerIntoHttpMux(comet, mux, "/rt", JSync.HttpInstallOptions{CookieSecret:"Gabriella"})


    bind:=":4040"
    fmt.Println("Serving",wwwDir,"on",bind)
    http.ListenAndServe(bind, mux)
}

