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

function mk_word(f, thisArg) {
   var a = Array(word);
   for (var i = 0; i < word; ++i) 
      a[i] = f.call(thisArg, i);
   return a;
}

function ALU(prob, x) {
   var ctl = this.ctl = prob.mk_vars(5);
   this.in0 = prob.mk_vars(word);
   this.in1 = prob.mk_vars(word);
   this.in2 = prob.mk_vars(word);
   this.inenb0 = prob.mk_or([ctl[3], ctl[4]]);
   this.inenb1 = ctl[4];
   this.inenb2 = prob.mk_and([ctl[2], ctl[4]]);

   var zero = mk_word(function() { return prob.mk_false() });
   prob.eqn_if(-this.inenb0, this.in0, zero);
   prob.eqn_if(-this.inenb1, this.in1, zero);
   prob.eqn_if(-this.inenb2, this.in2, zero);

   var tconst = mk_word(function(i) { return i == 0 ? this.ctl[0] : prob.mk_false() }, this);
   var tnot = this.in0.map(function(a) { return -a });
   var tshl1 = prob.mk_shift(this.in0, 1);
   var tshr1 = prob.mk_shift(this.in0, -1);
   var tshr4 = prob.mk_shift(this.in0, -4);
   var tshr16 = prob.mk_shift(this.in0, -16);
   var tand = prob.mk_andn([this.in0, this.in1]);
   var tor = prob.mk_orn([this.in0, this.in1]);
   var txor = prob.mk_xorn([this.in0, this.in1]);
   var tplus = prob.mk_ripplecarry(this.in0, this.in1);
   var tif0 = prob.mk_muxnn(this.in0, this.in1, this.in2);

   prob.implies([-ctl[4], -ctl[3], -ctl[2], ctl[1]], []);
   prob.implies([ctl[2], ctl[1]], []);
   prob.implies([ctl[2], ctl[0]], []);
   prob.implies([ctl[4], ctl[3]], []);

   var m00 = prob.mk_muxn(ctl[2], tconst, x);

   var msh1 = prob.mk_muxn(ctl[0], tshl1, tshr1);
   var mshr = prob.mk_muxn(ctl[0], tshr4, tshr16);
   var msh = prob.mk_muxn(ctl[1], msh1, mshr);
   var m01 = prob.mk_muxn(ctl[2], msh, tnot);

   var mao = prob.mk_muxn(ctl[0], tand, tor);
   var mxp = prob.mk_muxn(ctl[0], txor, tplus);
   var mop2 = prob.mk_muxn(ctl[1], mao, mxp);
   var m10 = prob.mk_muxn(ctl[2], mop2, tif0);

   var m0 = prob.mk_muxn(ctl[3], m00, m01);
   this.out = prob.mk_muxn(ctl[4], m0, m10);
}
exports.ALU = ALU; // for "unit testing"

ALU.prototype = {
}

