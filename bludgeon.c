#include <stdint.h>

typedef uint64_t u;
typedef const u* restrict uptr;

static const int nodes = 8;
static const int cases = 6;
#define casewise(i) for (i = 0; i < cases; ++i)
static const u xs =    { 16, 42, 128, 9, 11, 12 };
static const u goals = { 17, 42, 130, 9, 11, 13 };

typedef enum insn {
	I_ZERO  = 000,
	I_ONE   = 001,
	I_X     = 004,
	I_SHL1  = 010,
	I_SHR1  = 011,
	I_SHR4  = 012,
	I_SHR16 = 013,
	I_NOT   = 014,
	I_AND   = 020,
	I_OR    = 021,
	I_XOR   = 022,
	I_PLUS  = 023,
	I_IF0   = 024
} insn;
#define INENB0(i) (((i) & 010) != 0)
#define INENB1(i) (((i) & 020) != 0)
#define INENB2(i) (((i) & 024) == 024)

static uint8_t prog[nodes];
static uint8_t parent[nodes];

static void
try(int pc, uptr lo, uptr hi)
{
	int i, got;

	if (pc >= nodes)
		return;

#define leaf(cond, what)  do {				\
	    for (got = 1, i = 0; i < cases; ++i)	\
		    if (!(cond)) { got = 0; break }	\
	    if (got) {					\
		prog[pc] = what;			\
		finish(pc);				\
	    }						\
	} while(0);					\

	leaf(lo[i] == 0, I_ZERO);
	leaf((lo[i] & ~1) == 0 && (hi[i] & 1) != 0, I_ONE);
	leaf((lo[i] & ~x[i]) == 0 && (hi[i] & x[i]) == x[i], I_X);

	if (pc + 1 >= nodes)
		return;

	prog[pc] = I_NOT;
	try(pc + 1, map(~, hi), map(~, lo));
	
	/* This... is wrong tool. */
}
