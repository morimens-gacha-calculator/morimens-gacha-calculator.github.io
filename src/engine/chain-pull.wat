(module
  (import "env" "mem" (memory 1 65536 shared))
  ;; Pull form over a range of target states: next[j] = Σ_{e ∈ in(j)} cur[src[e]] · prob[e], j0 ≤ j < j1.
  ;; Returns Σ next[j] over the range, leaving out j = 0 (the "goal reached" sink).
  (func (export "pull") (param $rs i32) (param $src i32) (param $prob i32) (param $cur i32) (param $next i32)
                        (param $j0 i32) (param $j1 i32) (result f64)
    (local $j i32) (local $e i32) (local $end i32) (local $acc f64) (local $tot f64)
    (local.set $j (local.get $j0))
    (local.set $e (i32.load (i32.add (local.get $rs) (i32.shl (local.get $j0) (i32.const 2)))))
    (block $d1 (loop $l1
      (br_if $d1 (i32.ge_u (local.get $j) (local.get $j1)))
      (local.set $end (i32.load (i32.add (local.get $rs) (i32.shl (i32.add (local.get $j) (i32.const 1)) (i32.const 2)))))
      (local.set $acc (f64.const 0))
      (block $d2 (loop $l2
        (br_if $d2 (i32.ge_u (local.get $e) (local.get $end)))
        (local.set $acc (f64.add (local.get $acc)
          (f64.mul (f64.load (i32.add (local.get $cur) (i32.shl (i32.load (i32.add (local.get $src) (i32.shl (local.get $e) (i32.const 2)))) (i32.const 3))))
                   (f64.load (i32.add (local.get $prob) (i32.shl (local.get $e) (i32.const 3)))))))
        (local.set $e (i32.add (local.get $e) (i32.const 1)))
        (br $l2)))
      (f64.store (i32.add (local.get $next) (i32.shl (local.get $j) (i32.const 3))) (local.get $acc))
      (if (i32.ne (local.get $j) (i32.const 0)) (then (local.set $tot (f64.add (local.get $tot) (local.get $acc)))))
      (local.set $j (i32.add (local.get $j) (i32.const 1)))
      (br $l1)))
    (local.get $tot))
)
