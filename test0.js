.load stuff.js
lbv = rr("./lbv")
var p = new lbv.Program(3);
p.constrain_hex("0x10", "0x11")
function psol() {
   console.log("");
   if (p.soln) {
      p.alus.forEach(function(alu) {
	 console.log(p.soln.getbin(alu.op))
      });
      p.prob.not_that_one(p.soln);
      p.solve(psol);
   }
   else
      console.log("BEES");
}
p.solve(psol);

