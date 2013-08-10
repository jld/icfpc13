// -*- mode: javascript; indent-tabs-mode: nil; js-indent-level: 3 -*-
"use strict";
var sat = require("./sat"); // FIXME
var word = 64;
exports.word = 64;

// 00000 => 0
// 00001 => 1
// 0001x => #UD
// 00100 => x
// 010nn => [shl1, shr1, shr4, shr16]
// 01100 => not
// 100nn => [and, or, xor, plus]
// 10100 => if0
// xx1nn => #UD if nn != 00
// 11xxx => #UD
// So,
// inenb0 = or(ctl3, ctl4)
// inenb1 = ctl4
// inenb2 = and(ctl2, ctl4)

function iota(n, f, this_arg) {
   var a = Array(n);
   for (var i = 0; i < word; ++i)
      a[i] = f.call(this_arg, i);
   return a;
}

function mk_word(f, this_arg) {
   iota(word, f, this_arg);
}

function ALU(p, x) {
   var ctl = this.ctl = p.mk_vars(5);
   this.input = iota(3, function() { p.mk_vars(word) });
   this.inenb = [p.mk_or([ctl[3], ctl[4]]),
                 ctl[4],
                 p.mk_and([ctl[2], ctl[4]])];

   var zero = mk_word(function() { return p.mk_false() });
   for (var i = 0; i < 3; ++i)
      p.eqn_if(-this.inenb[i], this.input[i], zero);

   var tconst = mk_word(function(i) { return i == 0 ? this.ctl[0] : p.mk_false() }, this);
   var tnot = this.input[0].map(function(a) { return -a });
   var tshl1 = p.mk_shift(this.input[0], 1);
   var tshr1 = p.mk_shift(this.input[0], -1);
   var tshr4 = p.mk_shift(this.input[0], -4);
   var tshr16 = p.mk_shift(this.input[0], -16);
   var tand = p.mk_andn([this.input[0], this.input[1]]);
   var tor = p.mk_orn([this.input[0], this.input[1]]);
   var txor = p.mk_xorn([this.input[0], this.input[1]]);
   var tplus = p.mk_ripplecarry(this.input[0], this.input[1]);
   var tif0 = p.mk_muxnn(this.input[0], this.input[1], this.input[2]);

   p.implies([-ctl[4], -ctl[3], -ctl[2], ctl[1]], []);
   p.implies([ctl[2], ctl[1]], []);
   p.implies([ctl[2], ctl[0]], []);
   p.implies([ctl[4], ctl[3]], []);

   var m00 = p.mk_muxn(ctl[2], tconst, x);

   var msh1 = p.mk_muxn(ctl[0], tshl1, tshr1);
   var mshr = p.mk_muxn(ctl[0], tshr4, tshr16);
   var msh = p.mk_muxn(ctl[1], msh1, mshr);
   var m01 = p.mk_muxn(ctl[2], msh, tnot);

   var mao = p.mk_muxn(ctl[0], tand, tor);
   var mxp = p.mk_muxn(ctl[0], txor, tplus);
   var mop2 = p.mk_muxn(ctl[1], mao, mxp);
   var m10 = p.mk_muxn(ctl[2], mop2, tif0);

   var m0 = p.mk_muxn(ctl[3], m00, m01);
   this.output = p.mk_muxn(ctl[4], m0, m10);
}
exports.ALU = ALU; // for "unit testing"

ALU.prototype = {
}

