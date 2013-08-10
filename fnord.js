'use strict';
function many(n) {
   var a = Array(n);
   a[1] = 3;
   for (var i = 2; i < n; ++i) {
      a[i] = a[i-1] * 5;
      for (var j = 1; j < i && i-1-j >= 1; ++j) {
	 a[i] += (4 * a[j] * a[i-1-j]) / 2;
	 for (var k = 1; k < i && i-1-j-k >= 1; ++k)
	    a[i] += a[j] * a[k] * a[i-1-j-k];
      }
   }
   return a;
}
