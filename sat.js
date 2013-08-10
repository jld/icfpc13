// -*- mode: javascript; indent-tabs-mode: nil; js-indent-level: 3 -*-
"use strict";
var cld = require("child_process");
var DEFAULT_SOLVER = "picosat";

function listify(x) {
   return x instanceof Array ? x : [x];
}

function Problem() {
   this.lastvar = 0;
   this.clauses = [];
   this.solver_cmd = DEFAULT_SOLVER;
   this.sovler_opts = [];
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
   to_dimacs: function(on_data) {
      on_data("p cnf " + this.lastvar + " " + this.clauses.length + "\n");
      this.clauses.forEach(function(clause) {
         on_data(clause.join(" ") + " 0\n");
      });
   },
   to_dimacs_str: function() {
      var s = "";
      this.to_dimacs(function(data) { s += data });
      return s;
   },
   verbosely: function() {
      this.solver_opts.push("-v");
      return this;
   },
   solve: function(on_solved, this_arg) {
      var solver = cld.spawn(this.solver_cmd, this.solver_opts);
      solver.stderr.on('data', function(data) {
         data.split("\n").forEach(function(line) {
            if (line.length)
               console.log(solver_cmd + ": " + line);
         });
      });
      var satp;
      var atoms = [];
      var leftovers = "";
      solver.stdout.on('data', function(data) {
         var lines = (leftovers + data.toString()).split("\n");
         leftovers = lines.pop();
         lines.forEach(function(line) {
            switch (line[0]) {
            case 's':
               satp = line.slice(2) == "SATISFIABLE";
               break;
            case 'v':
               line.slice(2).split(" ").map(Number).forEach(function(atom) { atoms.push(atom) });
               break;
            default:
               console.log(solver_cmd + ": " + line);
            }
         });
      });
      solver.on('exit', function(code, signal) {
         if (signal) {
            console.log(solver_cmd + " exited on signal " + signal);
            on_solved.call(this_arg, undefined);
         } else if (typeof satp !== 'boolean') {
            console.log(solver_cmd + " did not decide!");
            on_solved.call(this_arg, undefined);
         } else if (!satp) {
            on_solved.call(this_arg, null);
         } else if (atoms[atoms.length - 1] !== 0) {
            console.log(solver_cmd + " did not finish writing assignments!");
            on_solved.call(this_arg, undefined);
         } else {
            atoms.pop();
            on_solved.call(this_arg, new Solution(atoms));
         }
      });
      this.to_dimacs(function(data) { solver.stdin.write(data) });
      solver.stdin.end();
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
   parity: function(atoms, /*opt*/ parity) {
      parity = parity ? 1 : 0;
      var n = atoms.length, nn = 1 << n, row = Array(n);
      for (var i = 0; i < nn; ++i) {
         // This could probably be optimized.  It probably doesn't matter.
         var popcount = 0;
         for (var j = 0; j < n; ++j) {
            popcount += (i >> j) & 1;
            row[j] = (i >> j) & 1 ? atoms[j] : -atoms[j];
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
   },
   mk_adder: function(a, b, c) {
      var lo = this.mk_xor([a, b, c]);
      var hi = this.mk_or([this.mk_and([a, b]),
                           this.mk_and([b, c]),
                           this.mk_and([c, a])]);
      return [lo, hi];
   },
   ////
   not_that_one: function(soln) {
      this.implies(soln.assigned, []);
   },
   mk_ripplecarry: function(as, bs) {
      var carry = this.mk_false();
      var out = Array(Math.min(as.length, bs.length));
      for (var i = 0; i < out.length; ++i) {
         var sum = this.mk_adder(as[i], bs[i], carry);
         out[i] = sum[0];
         carry = sum[1];
      }
      return out;
   },
   mk_shift: function(xs, n) {
      var out = Array(xs.length);
      for (var i = 0; i < out.length; ++i)
         out[i] = xs[i - n] || this.mk_false();
      return out;
   },
   eqn_if: function(ctl, as, bs) {
      for (var i = 0; i < as.length; ++i)
         this.eq_if(ctl, as[i], bs[i]);
   },
   mk_muxn: function(ctl, in0, in1) {
      var out = Array(in0.length);
      for (var i = 0; i < out.length; ++i)
         out[i] = this.mk_mux(ctl, in0[i], in1[i]);
      return out;
   },
   mk_muxnn: function(ctls, in0, in1) {
      var out = Array(ctls.length);
      for (var i = 0; i < out.length; ++i)
         out[i] = this.mk_mux(ctls[i], in0[i], in1[i]);
      return out;
   },
   mk_andn: function(ins) {
      var out = Array(ins[0].length);
      for (var i = 0; i < out.length; ++i)
         out[i] = this.mk_and(ins.map(function(x) { return x[i] }));
      return out;
   },
   mk_orn: function(ins) {
      var out = Array(ins[0].length);
      for (var i = 0; i < out.length; ++i)
         out[i] = this.mk_or(ins.map(function(x) { return x[i] }));
      return out;
   },
   mk_xorn: function(ins) {
      var out = Array(ins[0].length);
      for (var i = 0; i < out.length; ++i)
         out[i] = this.mk_xor(ins.map(function(x) { return x[i] }));
      return out;
   },
   set: function(atom, bool) {
      this.clause([bool ? atom : -atom]);
   },
   setn: function(atoms, bools) {
      atoms.map(function(atom, i) {
         this.set(atom, bools[i]);
      }, this);
   },
}


function Solution(atoms) {
   this.assigned = atoms;
   this.assignedp = [];
   atoms.forEach(function (atom) {
      this.assignedp[Math.abs(atom)] = atom > 0;
   }, this);
}

Solution.prototype = {
   get: function(index) {
      return this.assignedp[index];
   },
   mapget: function(indices) {
      return indices.map(function(index) { return this.get(index) }, this);
   },
   getint: function(indices) {
      // BEWARE FLOATING POINT
      var n = 0;
      for (var i = 0; i < indices.length; ++i)
         if (this.get(indices[i]))
            n |= 1 << i;
      return n;
   },
   getbin: function(indices) {
      var s = "";
      for (var i = 0; i < indices.length; i++)
         s = (this.get(indices[i]) ? "1" : "0") + s;
      return s;
   },
   gethex: function(indices) {
      var s = "";
      for (var i = 0; i < indices.length; i += 4)
         s = this.getint(indices.slice(i, i + 4)).toString(16) + s;
      return s;
   },
}
