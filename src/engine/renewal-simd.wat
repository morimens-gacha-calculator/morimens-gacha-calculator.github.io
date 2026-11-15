(module
  ;; Horner-style loops of the layered method (see renewal.js), two frequencies at a time with
  ;; f64x2 SIMD. Same operations in the same order as the JavaScript loops, so the same results.
  (memory (export "mem") 1)

  ;; For each frequency z in [z0, z1) (z1 − z0 even):
  ;;   x = 0; for m = M … 1: x = x·G(z) + c[m];  out(z) = x·H(z) + c0
  ;; gr, gi, hr, hi, outR, outI: f64 arrays indexed by z; c: f64 array indexed by m.
  (func (export "horner") (param $c i32) (param $M i32) (param $c0 f64)
                         (param $gr i32) (param $gi i32) (param $hr i32) (param $hi i32)
                         (param $outR i32) (param $outI i32) (param $z0 i32) (param $z1 i32)
    (local $z i32) (local $m i32) (local $o i32)
    (local $xr v128) (local $xi v128) (local $nr v128) (local $Gr v128) (local $Gi v128) (local $cm v128)
    (local.set $z (local.get $z0))
    (block $done (loop $zs
      (br_if $done (i32.ge_u (local.get $z) (local.get $z1)))
      (local.set $o (i32.shl (local.get $z) (i32.const 3)))
      (local.set $Gr (v128.load (i32.add (local.get $gr) (local.get $o))))
      (local.set $Gi (v128.load (i32.add (local.get $gi) (local.get $o))))
      (local.set $xr (f64x2.splat (f64.const 0)))
      (local.set $xi (f64x2.splat (f64.const 0)))
      (local.set $m (local.get $M))
      (block $mdone (loop $ms
        (br_if $mdone (i32.lt_s (local.get $m) (i32.const 1)))
        (local.set $cm (f64x2.splat (f64.load (i32.add (local.get $c) (i32.shl (local.get $m) (i32.const 3))))))
        ;; nr = xr·Gr − xi·Gi + c[m];  xi = xr·Gi + xi·Gr;  xr = nr
        (local.set $nr (f64x2.add (f64x2.sub (f64x2.mul (local.get $xr) (local.get $Gr)) (f64x2.mul (local.get $xi) (local.get $Gi))) (local.get $cm)))
        (local.set $xi (f64x2.add (f64x2.mul (local.get $xr) (local.get $Gi)) (f64x2.mul (local.get $xi) (local.get $Gr))))
        (local.set $xr (local.get $nr))
        (local.set $m (i32.sub (local.get $m) (i32.const 1)))
        (br $ms)))
      ;; out = x·H + c0 (c0 added to the real part only)
      (local.set $Gr (v128.load (i32.add (local.get $hr) (local.get $o))))
      (local.set $Gi (v128.load (i32.add (local.get $hi) (local.get $o))))
      (v128.store (i32.add (local.get $outR) (local.get $o))
        (f64x2.add (f64x2.sub (f64x2.mul (local.get $xr) (local.get $Gr)) (f64x2.mul (local.get $xi) (local.get $Gi))) (f64x2.splat (local.get $c0))))
      (v128.store (i32.add (local.get $outI) (local.get $o))
        (f64x2.add (f64x2.mul (local.get $xr) (local.get $Gi)) (f64x2.mul (local.get $xi) (local.get $Gr))))
      (local.set $z (i32.add (local.get $z) (i32.const 2)))
      (br $zs)))
  )

  ;; For each frequency z in [z0, z1) (even count), with weight wt[z]:
  ;;   w = W(z); for m = 1 … M: acc[m] += wt·Re(w); w = w·G(z)
  ;; (the two frequencies of a pair are added to acc[m] one after the other, z first: the same
  ;; order as the JavaScript loop over z)
  (func (export "parseval") (param $acc i32) (param $M i32)
                           (param $gr i32) (param $gi i32) (param $wr i32) (param $wi i32) (param $wt i32)
                           (param $z0 i32) (param $z1 i32)
    (local $z i32) (local $m i32) (local $o i32) (local $a i32)
    (local $Wr v128) (local $Wi v128) (local $nr v128) (local $Gr v128) (local $Gi v128) (local $T v128) (local $add v128)
    (local.set $z (local.get $z0))
    (block $done (loop $zs
      (br_if $done (i32.ge_u (local.get $z) (local.get $z1)))
      (local.set $o (i32.shl (local.get $z) (i32.const 3)))
      (local.set $Gr (v128.load (i32.add (local.get $gr) (local.get $o))))
      (local.set $Gi (v128.load (i32.add (local.get $gi) (local.get $o))))
      (local.set $Wr (v128.load (i32.add (local.get $wr) (local.get $o))))
      (local.set $Wi (v128.load (i32.add (local.get $wi) (local.get $o))))
      (local.set $T (v128.load (i32.add (local.get $wt) (local.get $o))))
      (local.set $m (i32.const 1))
      (block $mdone (loop $ms
        (br_if $mdone (i32.gt_s (local.get $m) (local.get $M)))
        (local.set $a (i32.add (local.get $acc) (i32.shl (local.get $m) (i32.const 3))))
        (local.set $add (f64x2.mul (local.get $T) (local.get $Wr)))
        (f64.store (local.get $a) (f64.add (f64.load (local.get $a)) (f64x2.extract_lane 0 (local.get $add))))
        (f64.store (local.get $a) (f64.add (f64.load (local.get $a)) (f64x2.extract_lane 1 (local.get $add))))
        (local.set $nr (f64x2.sub (f64x2.mul (local.get $Wr) (local.get $Gr)) (f64x2.mul (local.get $Wi) (local.get $Gi))))
        (local.set $Wi (f64x2.add (f64x2.mul (local.get $Wr) (local.get $Gi)) (f64x2.mul (local.get $Wi) (local.get $Gr))))
        (local.set $Wr (local.get $nr))
        (local.set $m (i32.add (local.get $m) (i32.const 1)))
        (br $ms)))
      (local.set $z (i32.add (local.get $z) (i32.const 2)))
      (br $zs)))
  )
)
