#include <assert.h>
#include <ctype.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

//

typedef uint64_t u64;
typedef struct table {
	size_t avail, used;
	struct table_cell *cells;
} table;

typedef struct table_cell {
	u64 hash;
	struct prog *prog;
} table_cell;
#define table_hash(c) (c->hash)
#define table_prog(c) (c->prog)

static void
table_init(table * tab) {
	tab->used = 0;
	tab->avail = 17;
	tab->cells = calloc(tab->avail, sizeof(table_cell));
}

typedef struct table_iter {
	table_cell *here, *end;
} table_iter;

static void
table_iter__advance(table_iter *iter)
{
	while (iter->here < iter->end && !iter->here->prog)
		iter->here++;
	if (iter->here >= iter->end)
		iter->here = NULL;
}

static void
table_iter_start(table_iter *iter, const table *root)
{
	iter->here = root->cells;
	iter->end = root->cells + root->avail;
	table_iter__advance(iter);
}

static void
table_iter_next(table_iter *iter)
{
	iter->here++;
	table_iter__advance(iter);
}

#define table_iter_for(iterl, tab) \
	table_iter_start(&iterl, &tab); iterl.here; table_iter_next(&iterl)


static table_cell *table_find_or_add(table *tab, u64 hash, struct prog *prog);

static void
table__expand(table *tab)
{
	size_t i, oldsize, newsize;
	table_cell *oldcells, *bees __attribute__((unused));

	oldsize = tab->avail;
	oldcells = tab->cells;
	newsize = oldsize + (oldsize + 1) / 2;
	tab->cells = calloc(newsize, sizeof(table_cell));
	tab->avail = newsize;
	tab->used = 0;
	for (i = 0; i < oldsize; ++i)
		if (oldcells[i].prog) {
			bees = table_find_or_add(tab, oldcells[i].hash, oldcells[i].prog);
			assert(!bees);
		}
	free(oldcells);
}

static table_cell *
table_find_or_add(table *tab, u64 hash, struct prog *prog)
{
	table_cell *ptr, *end;

	if (!tab->avail)
		table_init(tab);

	ptr = &tab->cells[hash % tab->avail];
	end = tab->cells + tab->avail;
	if (tab->used) {
		while (ptr->prog && ptr->hash != hash)
			if (++ptr >= end)
				ptr = tab->cells;
		if (ptr->prog)
			return ptr;
	} else
		assert(!ptr->prog);
	tab->used++;
	ptr->hash = hash;
	ptr->prog = prog;
	if (tab->used > tab->avail / 2)
		table__expand(tab);
	return NULL;
}

//

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

#define INENB0(i) (((i) & 030) != 0)
#define INENB1(i) (((i) & 020) != 0)
#define INENB2(i) (((i) & 024) == 024)

static uint32_t restricted = 0;
static const uint32_t restrictable = 0x001f1f00;

static void
restrict_ops(const char *stuff)
{
	uint32_t seen = 0;
	while (stuff) {
#define THING(name, bit) \
		if (strncmp(stuff, name, sizeof(name)-1) == 0)	\
			seen |= 1 << bit
		THING("shl1", I_SHL1);
		THING("shr1", I_SHR1);
		THING("shr4", I_SHR4);
		THING("shr16", I_SHR16);
		THING("not", I_NOT);
		THING("and", I_AND);
		THING("or", I_OR);
		THING("xor", I_XOR);
		THING("plus", I_PLUS);
		THING("if0", I_IF0);
		stuff = strchr(stuff, ',');
		if (stuff)
			stuff++;
	}
	restricted = restrictable & ~seen;
}

enum {
	MAXNODE = 30,
	MAXCASE = 512,
};
static size_t numcase = 16;

struct prog {
	uint8_t len;
	uint8_t nodes[MAXNODE];
	u64 out[0];
};

static struct prog *
prog_alloc(void) {
	return malloc(sizeof(struct prog) + numcase * sizeof(u64));
}

static u64
prog_hash(const struct prog *prog) {
	static const u64 phi = 0x9e3779b97f4a7c15;
	u64 hash = 0;
	int i;

	for (i = 0; i < numcase; ++i) {
		hash ^= prog->out[i];
		hash += (hash >> 43) | (hash << 21);
		hash ^= (hash >> 13) | (hash << 51);
		hash += (hash >> 9) | (hash << 55);
		hash ^= (hash >> 7) | (hash << 57);
		hash *= phi;
	}
	return hash;
}

static __attribute__((unused)) void
prog_fprint(const struct prog *prog, FILE *out) {
	uint8_t stack[MAXNODE];
	int i, sp, args;

	sp = 0;
	for (i = 0; i < prog->len; ++i) {
		uint8_t node = prog->nodes[i];

		switch (node) {
		case I_ZERO: fputs("0", out); break;
		case I_ONE: fputs("1", out); break;
		case I_X: fputs("x", out); break;
		case I_SHL1: fputs("(shl1 ", out); break;
		case I_SHR1: fputs("(shr1 ", out); break;
		case I_SHR4: fputs("(shr4 ", out); break;
		case I_SHR16: fputs("(shr16 ", out); break;
		case I_NOT: fputs("(not ", out); break;
		case I_AND: fputs("(and ", out); break;
		case I_OR: fputs("(or ", out); break;
		case I_XOR: fputs("(xor ", out); break;
		case I_PLUS: fputs("(plus ", out); break;
		case I_IF0: fputs("(if0 ", out); break;
		default: assert(0);
		}
		args = INENB0(node) + INENB1(node) + INENB2(node);
		if (args)
			stack[sp++] = args;
		else {
			while (sp > 0 && !--stack[sp-1]) {
				--sp;
				fputs(")", out);
			}
			if (sp > 0)
				fputs(" ", out);
		}
	}
}

//

static table all[MAXNODE];
static unsigned long num[MAXNODE];
static u64 xs[MAXCASE];
static u64 goal;
static int goal_mode, goal_final;

static void
make_known(struct prog *prog) {
	const table_cell *old;
	u64 hash = prog_hash(prog);

	if (goal_mode && hash == goal) {
		// Victory!
		prog_fprint(prog, stdout);
		fputs("\n", stdout);
		exit(0);
	}
	if (goal_final)
		return;

	old = table_find_or_add(&all[prog->len], hash, prog);
	if (!old) {
		++num[prog->len];
		return;
	}
	if (memcmp(&prog->out, &table_prog(old)->out, numcase * sizeof(u64)) != 0) {
		fprintf(stderr, "THE BEES COME DOWN! %p %p\n", prog, table_prog(old));
		abort();
	}
	free(prog);
}

static void
base_cases(void) {
	struct prog *prog;
	int i;

#define base_case(node, init) do {	\
	if (restricted & (1 << node))	\
		break;			\
	prog = prog_alloc();		\
	prog->len = 1;			\
	prog->nodes[0] = node;		\
	for (i = 0; i < numcase; ++i)	\
		prog->out[i] = init;	\
	make_known(prog);		\
} while(0)

	base_case(I_ZERO, 0);
	base_case(I_ONE, 1);
	base_case(I_X, xs[i]);
}

static void
unary_cases(int len) {
	table_iter t0;
	const struct prog *in0;
	struct prog *prog;
	int i;

#define unary_case(node, sfx) do {				\
	if (restricted & (1 << node))				\
		break;						\
	prog = prog_alloc();					\
	prog->len = len;					\
	prog->nodes[0] = node;					\
	memcpy(&prog->nodes[1], &in0->nodes[0], in0->len); 	\
	for (i = 0; i < numcase; ++i)				\
		prog->out[i] = in0->out[i] sfx;			\
	make_known(prog);					\
} while(0)

	for (table_iter_for(t0, all[len - 1])) {
		in0 = table_prog(t0.here);
		unary_case(I_SHL1, << 1);
		unary_case(I_SHR1, >> 1);
		unary_case(I_SHR4, >> 4);
		unary_case(I_SHR16, >> 16);
		unary_case(I_NOT, ^ ~0);
	}
}

static void
binary_cases(int len) {
	table_iter t0, t1;
	const struct prog *in0, *in1;
	struct prog *prog;
	int i, leftlen;

#define binary_case(node, infix) do {					\
	if (restricted & (1 << node))					\
		break;							\
	prog = prog_alloc();						\
	prog->len = len;						\
	prog->nodes[0] = node;						\
	assert(1 + in0->len + in1->len == len);				\
	memcpy(&prog->nodes[1], &in0->nodes[0], in0->len);		\
	memcpy(&prog->nodes[1 + in0->len], &in1->nodes[0], in1->len);	\
	for (i = 0; i < numcase; ++i)					\
		prog->out[i] = in0->out[i] infix in1->out[i];		\
	make_known(prog);						\
} while(0);

	for (leftlen = 1; leftlen < len - 1; ++leftlen)
		for (table_iter_for(t0, all[leftlen])) {
			in0 = table_prog(t0.here);
			for (table_iter_for(t1, all[len - 1 - leftlen])) {
				in1 = table_prog(t1.here);
				binary_case(I_AND, &);
				binary_case(I_OR, |);
				binary_case(I_XOR, ^);
				binary_case(I_PLUS, +);
			}
		}
}

static void ternary_cases(int len) {
	table_iter t0, t1, t2;
	const struct prog *in0, *in1, *in2;
	struct prog *prog;
	int i, len0, len1;

	if (restricted & (1 << I_IF0))
		return;

	for (len0 = 1; len0 < len - 2; ++len0)
		for (table_iter_for(t0, all[len0])) {
			in0 = table_prog(t0.here);
			for (len1 = 1; len1 < len - 1 - len0; ++len1)
				for (table_iter_for(t1, all[len1])) {
					in1 = table_prog(t1.here);
					for (table_iter_for(t2, all[len - 1 - len0 - len1])) {
						in2 = table_prog(t2.here);
						prog = prog_alloc();
						prog->len = len;
						prog->nodes[0] = I_IF0;
						assert(1 + in0->len + in1->len + in2->len == len);
						memcpy(&prog->nodes[1],
						    &in0->nodes[0], in0->len);
						memcpy(&prog->nodes[1 + in0->len],
						    &in1->nodes[0], in1->len);
						memcpy(&prog->nodes[1 + in0->len + in1->len],
						    &in1->nodes[0], in2->len);
						for (i = 0; i < numcase; ++i)
							prog->out[i] = (~in0->out[i] & in1->out[i])
							    | (in0->out[i] & in2->out[i]);
					}
				}
		}
}

static void all_cases(int len) {
	if (len == 1)
		base_cases();
	if (len >= 2)
		unary_cases(len);
	if (len >= 3)
		binary_cases(len);
	if (len >= 4)
		ternary_cases(len);
}

static void cases_upto(int limit) {
	int i;

	for (i = 1; i <= limit; ++i) {
		fprintf(stderr, "Computing cases of length %d: ", i);
		all_cases(i);
		fprintf(stderr, "%lu\n", num[i]);
	}
}

//

static void
xs_randomly(void)
{
	FILE *rnd;

	rnd = fopen("/dev/urandom", "rb");
	setbuf(rnd, NULL);
	fread(&xs, numcase * sizeof(u64), 1, rnd);
	fclose(rnd);
}

static int
parse_u64s(const char *s, u64 *us, int max) {
	int i, n;

	for (i = 0; i < max; ++i) {
		if (sscanf(s, "%"SCNx64"%n", &us[i], &n) < 1)
			break;
		s += n;
		if (*s == ',')
			++s;
	}
	return i;
}

static void
xs_from_string(const char *s)
{
	numcase = parse_u64s(s, xs, MAXCASE);
}

int
main(int argc, char **argv)
{
	int upto = 10;

	if (argc > 1)
		upto = atoi(argv[1]);
	assert(upto <= MAXNODE);

	if (argc > 2 && isalnum(argv[2][0]))
		restrict_ops(argv[2]);

	if (argc > 3)
		xs_from_string(argv[3]);
	else
		xs_randomly(); // TODO: allow altering numcase here

//	for (i = 0; i < numcase; ++i)
//		fprintf(stderr, "x = 0x%016"PRIx64"\n", xs[i]);

	if (argc > 4) {
		numcase = MAXCASE;
		struct prog *fake = prog_alloc();

		upto--;
		goal_mode = 1;
		numcase = parse_u64s(argv[4], fake->out, MAXCASE);
		goal = prog_hash(fake);
		free(fake);
	}

	cases_upto(upto);
	if (goal_mode) {
		goal_final = 1;
		all_cases(upto + 1);
		return 1;
	}
	return 0;
}
