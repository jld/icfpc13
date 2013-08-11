#include <assert.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

//

typedef uint64_t u64;
typedef struct node *table;

struct node {
	u64 bit;
	union {
		table next[2];
		struct {
			u64 hash;
			struct prog *prog;
		} leaf;
	} body;
};

#define table_isleaf(t) ((t)->bit == 0)
#define table_ispair(t) (!table_isleaf(t))
#define table_hash(t) (assert(table_isleaf(t)), (t)->body.leaf.hash)
#define table_prog(t) (assert(table_isleaf(t)), (t)->body.leaf.prog)
#define table_left(t) (assert(table_ispair(t)), (t)->body.next[0])
#define table_right(t) (assert(table_ispair(t)), (t)->body.next[1])

typedef struct table_iter {
	table here;
	int sp;
	table stack[64];
} table_iter;

static void
table_iter__toleaf(table_iter *iter)
{
	if (!iter->here)
		return;
	while (table_ispair(iter->here)) {
		assert(iter->sp < 64);
		iter->stack[iter->sp++] = table_right(iter->here);
		iter->here = table_left(iter->here);
	}
}

static void
table_iter_start(table_iter *iter, table root)
{
	iter->here = root;
	iter->sp = 0;
	table_iter__toleaf(iter);
}

static void
table_iter_next(table_iter *iter)
{
	assert(iter->here);
	iter->here = iter->sp ? iter->stack[--iter->sp] : NULL;
	table_iter__toleaf(iter);
}

#define table_iter_for(iterl, root) \
	table_iter_start(&iterl, root); iterl.here; table_iter_next(&iterl)

static table*
table__findleaf(table *root, u64 hash)
{
	assert(*root);
	while (table_ispair(*root))
		root = &(*root)->body.next[!!((*root)->bit & hash)];
	return root;
}

static __attribute__((unused)) table
table_find_sloppily(table root, u64 hash)
{
	return *(table__findleaf(&root, hash));
}

static __attribute__((unused)) table
table_find(table root, u64 hash)
{
	table there;

	there = table_find_sloppily(root, hash);
	return table_hash(there) == hash ? there : NULL;
}

static table
table_find_or_add(table *root, u64 hash, struct prog *prog)
{
	table leaf, pair;
	u64 old, bit;

	leaf = malloc(sizeof(struct node));	
	leaf->bit = 0;
	leaf->body.leaf.hash = hash;
	leaf->body.leaf.prog = prog;

	if (!*root) {
		*root = leaf;
		return NULL;
	}
	root = table__findleaf(root, hash);
	old = table_hash(*root);
	if (old == hash) {
		free(leaf);
		return *root;
	}
	bit = old ^ hash;
	bit = bit & -bit;
	pair = malloc(sizeof(struct node));
	pair->bit = bit;
	pair->body.next[!!(hash & bit)] = leaf;
	pair->body.next[!!(old & bit)] = *root;
	*root = pair;
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
	MAXCASE = 16,
	HASHCASE = MAXCASE,
};

struct prog {
	uint8_t len;
	uint8_t nodes[MAXNODE];
	u64 out[MAXCASE];
};

static u64
prog_hash(const struct prog *prog) {
	static const u64 phi = 0x9e3779b97f4a7c15;
	u64 hash = 0;
	int i;

	for (i = 0; i < HASHCASE; ++i) {
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

static void
make_known(struct prog *prog) {
	table old;

	old = table_find_or_add(&all[prog->len], prog_hash(prog), prog);
	if (!old) {
		++num[prog->len];
		return;
	}
	if (memcmp(&prog->out, &table_prog(old)->out, HASHCASE * 8) != 0) {
		fprintf(stderr, "THE BEES COME DOWN! %p %p\n", prog, table_prog(old));
		abort();
	}
	if (memcmp(&prog->out, &table_prog(old)->out, MAXCASE * 8) != 0) {
#if 0
		fputs("Collision: ", stderr);
		prog_fprint(table_prog(old), stderr);
		fputs(" != ", stderr);
		prog_fprint(prog, stderr);
		fputs("\n", stderr);
#endif
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
	prog = malloc(sizeof *prog);	\
	prog->len = 1;			\
	prog->nodes[0] = node;		\
	for (i = 0; i < MAXCASE; ++i)	\
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
	prog = malloc(sizeof *prog);				\
	prog->len = len;					\
	prog->nodes[0] = node;					\
	memcpy(&prog->nodes[1], &in0->nodes[0], in0->len); 	\
	for (i = 0; i < MAXCASE; ++i)				\
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
	prog = malloc(sizeof *prog);					\
	prog->len = len;						\
	prog->nodes[0] = node;						\
	assert(1 + in0->len + in1->len == len);				\
	memcpy(&prog->nodes[1], &in0->nodes[0], in0->len);		\
	memcpy(&prog->nodes[1 + in0->len], &in1->nodes[0], in1->len);	\
	for (i = 0; i < MAXCASE; ++i)					\
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
						prog = malloc(sizeof *prog);
						prog->len = len;
						prog->nodes[0] = I_IF0;
						assert(1 + in0->len + in1->len + in2->len == len);
						memcpy(&prog->nodes[1],
						    &in0->nodes[0], in0->len);
						memcpy(&prog->nodes[1 + in0->len],
						    &in1->nodes[0], in1->len);
						memcpy(&prog->nodes[1 + in0->len + in1->len], 
						    &in1->nodes[0], in2->len);
						for (i = 0; i < MAXCASE; ++i)
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

#include <unistd.h>
#include <fcntl.h>

int
main(int argc, char **argv)
{
	int fd, upto = 10;
	char *rp;
	size_t s;
	ssize_t r;

	if (argc > 1)
		upto = atoi(argv[1]);
	assert(upto <= MAXNODE);

	if (argc > 2)
		restrict_ops(argv[2]);

	fd = open("/dev/urandom", O_RDONLY);
	for (rp = (char*)&xs, s = sizeof(xs); s > 0; rp += r, s -= r) {
		r = read(fd, rp, s);
		if (r <= 0)
			abort();
	}
//	for (i = 0; i < HASHCASE; ++i)
//		fprintf(stderr, "x = 0x%016"PRIx64"\n", xs[i]);

	cases_upto(upto);
	return 0;
}
