.load stuff.js
lbv = rr("./lbv")
var p = new lbv.Program(8);
p.constrain_hex("10", "11")
p.constrain_hex("2a", "2b")
p.constrain_hex("80", "82")
p.constrain_hex("09", "09")
p.constrain_hex("0b", "0b")
p.constrain_hex("0c", "0d")
function psol() {
   console.log("");
   if (p.soln) {
      p.alus.forEach(function(alu) {
	 console.log(p.soln.getbin(alu.op))
      });
      p.prob.not_that_one(p.soln);
      //      p.solve(psol);
   } else
      console.log("BEES");
}
p.solve(psol);
