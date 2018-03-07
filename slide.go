package JSync  // I'm using the JSync package with a 'Slide' prefix so I don't need to restructure my code for a subpackage.

import (
    "seb/dyn"
)

// See slide.js for commentary.

// I made a general change: I place the 'error' return value as the last value instead of the first value, to fit better into the Go ecosystem.

// Also, I am dramatically simplifying the library to only do what I actually need.  The JS version does a lot of extra convenience and magic that I don't ever use.

type SlideNext func(data interface{}, err error)
type SlideFn struct {
    fn   interface{}
    args []interface{}
}
func (s SlideFn) Call(next SlideNext) { dyn.Call(s.fn, append(s.args,next)...) }

func SlideChain(steps []SlideFn, cb func(results []interface{}, err error)) {
    if cb==nil { cb=func([]interface{},error){} }
    res:=make([]interface{},0,len(steps))
    var LOOP func(int)
    LOOP=func(i int) {
        NEXT:=func() { LOOP(i+1) }  // In JS I prevent stack overflow, but don't care about that in Go.
        if i>=len(steps) { cb(res,nil); return }
        steps[i].Call(func(data interface{}, err error) {
            if err!=nil { cb(res,err); return }
            res=append(res,data)
            NEXT(); return
        })
    }
    LOOP(0)
}


