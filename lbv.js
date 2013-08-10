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
// inenb0 = or(op3, op4)
// inenb1 = op4
// inenb2 = and(op2, op4)

function iota(n, f, this_arg) {
   var a = Array(n);
   for (var i = 0; i < n; ++i)
      a[i] = f.call(this_arg, i);
   return a;
}

function mk_word(f, this_arg) {
   return iota(word, f, this_arg);
}



function ALU(p) {
   this.prob = p;
   var op = this.op = p.mk_vars(5);
   this.inenb = [p.mk_or([op[3], op[4]]),
                 op[4],
                 p.mk_and([op[2], op[4]])];
}
exports.ALU = ALU; // for "unit testing"

ALU.prototype = {
   data: function(x) {
      return new ALUdata(this, x);
   }
}


function ALUdata(ctl, x) {
   var p = ctl.prob;
   var op = ctl.op
   this.ctl = ctl;
   this.input = iota(3, function() { return p.mk_vars(word) });

   var zero = mk_word(function() { return p.mk_false() });
   for (var i = 0; i < 3; ++i)
      p.eqn_if(-ctl.inenb[i], this.input[i], zero);

   var tconst = mk_word(function(i) { return i == 0 ? op[0] : p.mk_false() }, this);
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

   p.implies([-op[4], -op[3], -op[2], op[1]], []);
   p.implies([op[2], op[1]], []);
   p.implies([op[2], op[0]], []);
   p.implies([op[4], op[3]], []);

   var m00 = p.mk_muxn(op[2], tconst, x);

   var msh1 = p.mk_muxn(op[0], tshl1, tshr1);
   var mshr = p.mk_muxn(op[0], tshr4, tshr16);
   var msh = p.mk_muxn(op[1], msh1, mshr);
   var m01 = p.mk_muxn(op[2], msh, tnot);

   var mao = p.mk_muxn(op[0], tand, tor);
   var mxp = p.mk_muxn(op[0], txor, tplus);
   var mop2 = p.mk_muxn(op[1], mao, mxp);
   var m10 = p.mk_muxn(op[2], mop2, tif0);

   var m0 = p.mk_muxn(op[3], m00, m01);
   this.output = p.mk_muxn(op[4], m0, m10);
}


function Program(size) {
   var p = this.prob = new sat.Problem;
   this.size = size;
   this.alus = iota(size, function() { return new ALU(p) }, this);
   this.constraints = [];

   function zeroes() {
      return iota(size, function() { return iota(size, function() { return p.mk_false() }) });
   }
   // inroute[0][i][i+1] = [i]inenb[0]
   // inroute[l+1][i][k+1] = {j} [i]inenb[l+1] && inroute[l][i][j] && rightmost[j][k]
   // rightmost[i][i] = ![i]inenb[0]
   // rightmost[i][k] = {j,l} ![i]inenb[l+1] && inroute[l][i][j] && rightmost[j][k]
   // ...
   // Routing.
   this.inroute = iota(3, zeroes); // [which][to][from]
   for (var i = 0; i < size; ++i) {
      // Special case: in0 is the next one or not at all.
      if (i < size - 1)
         this.inroute[0][i][i+1] = p.mk_var();
      for (var j = i + 2; j < size; ++j)
         for (var k = 1; k < 3; ++k)
            if (j > i + k)
               this.inroute[k][i][j] = p.mk_var();
   }

   // Output must go somewhere:
   for (var i = 1; i < size; ++i) {
      var outbound = [];
      for (var j = 0; j < i; ++j)
         for (var k = 0; k < 3; ++k)
            outbound.push(this.inroute[k][j][i]);
      p.pop_eq1(outbound);
   }
   // Input sometimes comes from somewhere.
   for (var i = 0; i < size; ++i)
      for (var j = 0; j < 3; ++j) {
         // There must be either exactly one input, or none and !inenb:
         p.pop_eq1(this.inroute[j][i].concat([-this.alus[i].inenb[j]]));
      }
   // Find the rightmost.
   this.rightmost = zeroes();
   for (var i = size - 1; i >= 0; --i) {
      // Iff no arguments, it's its own rightmost.
      this.rightmost[i][i] = -this.alus[i].inenb[0];
      for (var j = i + 1; j < size; ++j) {
         var acc = [];
         for (var k = i + 1; k <= j; ++k)
            for (var l = 0; l < 3; ++l)
               // If no |l+1|th argument, rightmost is lth arg's rightmost.
               acc.push(p.mk_and([-(this.alus[i].inenb[l+1] || p.mk_false()),
                                  this.inroute[l][i][k],
                                  this.rightmost[k][j]]));
         this.rightmost[i][j] = p.mk_or(acc);
      }
   }
   // Route the |l+1|th arg to the |l|'s arg's rightmost + 1.
   for (var i = 0; i < size; ++i)
      for (var j = i + 1; j < size; ++j)
         for (var k = j; k < size - 1; ++k)
            for (var l = 0; l < 3 - 1; ++l)
               p.implies([this.alus[i].inenb[l+1],
                          this.inroute[l][i][j], this.rightmost[j][k]],
                         this.inroute[l+1][i][k+1]);
   // And this *should* completely determine the routing matrices given the inenbs.
   // No proof of this claim is herein attempted.
}
exports.Program = Program;

Program.prototype = {
   constrain: function(input, output) {
      var cons = new ProgramData(this);
      this.constraints.push(cons);
      this.prob.setn(cons.x, input);
      this.prob.setn(cons.output, output);
   },
   solve: function(on_ready, this_arg) {
      this.prob.solve(function(soln) {
         this.soln = soln;
         on_ready.call(this_arg, this);
      }, this);
   },
}


function ProgramData(ctl) {
   this.ctl = ctl;
   var p = ctl.prob;
   this.x = p.mk_vars(word);
   this.alus = ctl.alus.map(function(alu) { return alu.data(this.x) }, this);
   this.output = this.alus[0].output;

   for (var i = 0; i < ctl.size; ++i)
      for (var j = i + 1; j < ctl.size; ++j)
         for (var k = 0; k < 3; ++k)
            p.eqn_if(ctl.inroute[k][i][j], this.alus[i].input[k], this.alus[j].output);
}

ProgramData.prototype = {
}
