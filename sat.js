// -*- Mode: javascript; indent-tabs-mode: nil; js-indent-level: 3 -*-
"use strict";

function listify(x) {
   return x instanceof Array ? x : [x];
}

function Problem() {
   this.lastvar = 0;
   this.clauses = [];
}
exports.Problem = Problem;

Problem.prototype = {
   mk_true: function () {
      return Infinity;
   },
   mk_false: function () {
      return -Infinity;
   },
   mk_var: function() {
      return ++this.lastvar;
   },
   mk_vars: function(n) {
      var acc = [];
      while (n--)
         acc.push(this.mk_var());
      return acc;
   },
   clause: function(atoms) {
      var clause = [], meaningful = true;
      atoms.forEach(function (atom) {
         if (atom === Infinity)
            meaningful = false;
         else if (atom === -Infinity)
            /* skip */;
         else
            clause.push(atom);
      }, this);
      if (meaningful)
         this.clauses.push(clause);
   },
   to_dimacs: function() {
      var s = "p cnf " + this.lastvar + " " + this.clauses.length + "\n";
      this.clauses.forEach(function(clause) {
         s += clause.join(" ") + " 0\n";
      });
      return s;
   },
   ////
   implies: function(antecedents, consequents) {
      // and(antecedents) -> or(consequents)
      antecedents = listify(antecedents);
      consequents = listify(consequents);
      this.clause(antecedents.map(function(v) { return -v }).concat(consequents));
   },
   mk_and: function(inputs) {
      var output = this.mk_var();
      this.implies(inputs, output);
      inputs.forEach(function(input) {
         this.implies(-input, -output);
      }, this);
      return output;
   },
   mk_or: function(inputs) {
      var output = this.mk_var();
      this.implies(output, inputs);
      inputs.forEach(function(input) {
         this.implies(-output, -input);
      }, this);
      return output;
   },
   pop_ge1: function(atoms) {
      this.implies([], atoms);
   },
   pop_le1: function(atoms) {
      for (var i = 0; i < atoms.length; ++i)
         for (var j = i + 1; j < atoms.length; ++j)
            this.implies([atoms[i], atoms[j]], []);
   },
   pop_eq1: function(atoms) {
      this.pop_ge1(atoms);
      this.pop_le1(atoms);
   },
   parity: function(atoms) {
      var parity = arguments[1] ? 1 : 0;
      var n = atoms.length, nn = 1 << n;
      for (var i = 0; i < nn; ++i) {
         // This could probably be optimized.  It probably doesn't matter.
         var popcount = 0, row = [];
         for (var j = 0; j < n; ++j) {
            popcount += (i >> j) & 1;
            row.push((i >> j) & 1 ? atoms[j] : -atoms[j]);
         }
         if ((popcount & 1) != parity)
            this.implies(row, []);
      }
   },
   mk_xor: function(inputs) {
      var output = this.mk_var();
      this.parity([output].concat(inputs));
      return output;
   },
   eq_if: function(ctl, atom0, atom1) {
      this.implies([ctl, atom0], atom1);
      this.implies([ctl, atom1], atom0);
   },
   mk_mux: function(ctl, input0, input1) {
      var output = this.mk_var();
      this.eq_if(-ctl, input0, output);
      this.eq_if(ctl, input1, output);
      return output;
   }
}
