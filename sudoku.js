// -*- mode: javascript; indent-tabs-mode: nil; js-indent-level: 3 -*-
"use strict";
var sat = require("./sat"); // FIXME

function Board() { 
   var p = new sat.Problem;
   var i = [];
   var vs = p.mk_vars(9*9*9);
   [[0,1,2,3,4,5],
    [0,1,4,5,2,3],
    [4,5,0,1,2,3],
    [0,4,1,5,2,3]].forEach(function(swizzle) {
       for (i[0] = 0; i[0] < 3; i[0]++)
          for (i[1] = 0; i[1] < 3; i[1]++)
             for (i[2] = 0; i[2] < 3; i[2]++)
                for (i[3] = 0; i[3] < 3; i[3]++) {
                   var zone = [];
                   for (i[4] = 0; i[4] < 3; i[4]++)
                      for (i[5] = 0; i[5] < 3; i[5]++) {
                         var n = 0;
                         for (var j = 0; j < 6; ++j) {
                            n = n * 3 + i[swizzle[j]];
                         }
                         zone.push(vs[n]);
                      }
                   p.pop_eq1(zone);
                }
    });
   this.prob = p;
   this.vars = vs;
}
exports.Board = Board;

Board.prototype = {
   set: function(row, col, num) {
      this.prob.implies([], this.vars[row * 81 + col * 9 + num]);
   },
   solve: function(on_soln, on_none) {
      this.prob.solve((function(raw_soln) {
         if (!raw_soln) {
            if (on_none)
               on_none();
            return;
         }
         var soln = [];
         for (var row = 0; row < 9; row++) {
            soln[row] = [];
            for (var col = 0; col < 9; col++)
               for (var num = 0; num < 9; num++)
                  if (raw_soln.get(this.vars[row * 81 + col * 9 + num]))
                     soln[row][col] = num;
         }
         this.prob.not_that_one(raw_soln);
         on_soln(soln)
      }).bind(this));
   }
}

function print_soln(soln, out) {
   out = out || process.stdout;
   out.write("\n")
   for (var row = 0; row < 9; row++) {
      for (var col = 0; col < 9; col++)
         out.write(soln[row][col] + 1 + "")
      out.write("\n")
   }
}
exports.print_soln = print_soln;

