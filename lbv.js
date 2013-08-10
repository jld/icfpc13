// -*- mode: javascript; indent-tabs-mode: nil; js-indent-level: 3 -*-
"use strict";
var sat = require("./sat"); // FIXME
var word = 64;

// 0000 => 0
// 0001 => 1
// 0010 => not
// 0011 => #UD
// 01nn => [shl1, shr1, shr4, shr16]
// 10nn => [and, or, xor, plus]
// 1100 => if0
// 11x1 => #UD
// 111x => #UD
// So,
// inenb0 = or(op1, op2, op3)
// inenb1 = op3
// inenb2 = and(op2, op3)

function mk_word(f, thisArg) {
   var a = Array(word);
   for (var i = 0; i < word; ++i) 
      a[i] = f.call(thisArg, i);
   return a;
}

function ALU(prob) {
   var ctl = this.ctl = prob.mk_vars(4);
   this.in0 = prob.mk_vars(word);
   this.in1 = prob.mk_vars(word);
   this.in2 = prob.mk_vars(word);
   this.inenb0 = prob.mk_or([ctl[1], ctl[2], ctl[3]]);
   this.inenb1 = ctl[3];
   this.inenb2 = prob.mk_and([ctl[2], ctl[3]]);

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
   var tor = prob.mk_andn([this.in0, this.in1]);
   var txor = prob.mk_andn([this.in0, this.in1]);
   var tplus = prob.mk_ripplecarry(this.in0, this.in1);
   var tif0 = prob.mk_muxnn(this.in0, this.in1, this.in2);

   prob.implies([ctl[0], ctl[1], -ctl[2], -ctl[3]], []);
   var m00 = prob.mk_muxn(ctl[1], tconst, tnot);

   var msh1 = prob.mk_muxn(ctl[0], tshl1, tshr1);
   var mshr = prob.mk_muxn(ctl[0], tshr4, tshr16);
   var msh = prob.mk_muxn(ctl[1], msh1, mshr);

   var mao = prob.mk_muxn(ctl[0], tand, tor);
   var mxp = prob.mk_muxn(ctl[0], txor, tplus);
   var mop2 = prob.mk_muxn(ctl[1], mao, mxp);

   prob.implies([ctl[0], ctl[2], ctl[3]], []);
   prob.implies([ctl[1], ctl[2], ctl[3]], []);

   var m0 = prob.mk_muxn(ctl[2], m00, msh);
   var m1 = prob.mk_muxn(ctl[2], mop2, tif0);
   this.out = prob.mk_muxn(ctl[3], m0, m1);
}
exports.ALU = ALU; // for "unit testing"

ALU.prototype = {
}

