;; The generated program from Lecture 10, slide 11.
;; Build: wat2wasm hypotenuse.wat -o hypotenuse.wasm
(module
  (func $CalcHypotenuse
    (param $var0 f64) (param $var1 f64) (result f64)
    (local $var2 f64)       ;; c_sqr
    (local.get $var0)
    (local.get $var0)
    (f64.mul)
    (local.get $var1)
    (local.get $var1)
    (f64.mul)
    (f64.add)
    (local.set $var2)
    (local.get $var2)       ;; Assignment result
    (drop)                 ;; Unused by statement
    (local.get $var2)
    (f64.sqrt)
    (return)
  )
  (export "CalcHypotenuse" (func $CalcHypotenuse))
)
