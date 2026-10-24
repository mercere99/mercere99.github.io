(module
  ;; Handwritten workshop fallback. Inputs: small nonnegative integers.
  (func $gcd (export "GCD") (param $a f64) (param $b f64) (result f64)
    (if (f64.eq (local.get $a) (f64.const 0))
      (then (return (local.get $b))))
    (if (f64.eq (local.get $b) (f64.const 0))
      (then (return (local.get $a))))
    (block $exit
      (loop $again
        (local.get $a)
        (local.get $b)
        (f64.ne)
        (i32.eqz)
        (br_if $exit)
        (local.get $a)
        (local.get $b)
        (f64.gt)
        (if
          (then
            (local.set $a
              (f64.sub (local.get $a) (local.get $b))))
          (else
            (local.set $b
              (f64.sub (local.get $b) (local.get $a)))))
        (br $again)
      )
    )
    (return (local.get $a))
  )
)
