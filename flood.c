#include <assert.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

//

typedef uint64_t u64;
typedef struct node *tree;

struct node {
	u64 bit;
	union {
		tree next[2];
		struct {
			u64 hash;
			struct prog *prog;
		} leaf;
	} body;
};

#define tree_isleaf(t) ((t)->bit == 0)
#define tree_ispair(t) (!tree_isleaf(t))
#define tree_hash(t) (assert(tree_isleaf(t)), (t)->body.leaf.hash)
#define tree_prog(t) (assert(tree_isleaf(t)), (t)->body.leaf.prog)
#define tree_left(t) (assert(tree_ispair(t)), (t)->body.next[0])
#define tree_right(t) (assert(tree_ispair(t)), (t)->body.next[1])

typedef struct tree_iter {
	tree here;
	int sp;
	tree stack[64];
} tree_iter;

static void
tree_iter__toleaf(tree_iter *iter)
{
	if (!iter->here)
		return;
	while (tree_ispair(iter->here)) {
		assert(iter->sp < 64);
		iter->stack[iter->sp++] = tree_right(iter->here);
		iter->here = tree_left(iter->here);
	}
}

static void
tree_iter_start(tree_iter *iter, tree root)
{
	iter->here = root;
	iter->sp = 0;
	tree_iter__toleaf(iter);
}

static void
tree_iter_next(tree_iter *iter)
{
	assert(iter->here);
	iter->here = iter->sp ? iter->stack[--iter->sp] : NULL;
	tree_iter__toleaf(iter);
}

#define tree_iter_for(iterl, root) \
	tree_iter_start(&iterl, root); iterl.here; tree_iter_next(&iterl)

static tree*
tree__findleaf(tree *root, u64 hash)
{
	assert(*root);
	while (tree_ispair(*root))
		root = &(*root)->body.next[!!((*root)->bit & hash)];
	return root;
}

static tree
tree_find_sloppily(tree root, u64 hash)
{
	return *(tree__findleaf(&root, hash));
}

static tree
tree_find(tree root, u64 hash)
{
	tree there;

	there = tree_find_sloppily(root, hash);
	return tree_hash(there) == hash ? there : NULL;
}

static tree
tree_find_or_add(tree *root, u64 hash, struct prog *prog)
{
	tree leaf, pair;
	u64 old, bit;

	leaf = malloc(sizeof(struct node));	
	leaf->bit = 0;
	leaf->body.leaf.hash = hash;
	leaf->body.leaf.prog = prog;

	if (!*root) {
		*root = leaf;
		return NULL;
	}
	root = tree__findleaf(root, hash);
	old = tree_hash(*root);
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

u64
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

static void
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

static tree all[MAXNODE];
static unsigned long num[MAXNODE];
static u64 xs[MAXCASE];

static void
make_known(struct prog *prog) {
	tree old;

	old = tree_find_or_add(&all[prog->len], prog_hash(prog), prog);
	if (!old) {
		++num[prog->len];
		return;
	}
	if (memcmp(&prog->out, &tree_prog(old)->out, HASHCASE * 8) != 0) {
		fprintf(stderr, "THE BEES COME DOWN! %p %p\n", prog, tree_prog(old));
		abort();
	}
	if (memcmp(&prog->out, &tree_prog(old)->out, MAXCASE * 8) != 0) {
#if 0
		fputs("Collision: ", stderr);
		prog_fprint(tree_prog(old), stderr);
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
	tree_iter t0;
	const struct prog *in0;
	struct prog *prog;
	int i;

#define unary_case(node, sfx) do {				\
	prog = malloc(sizeof *prog);				\
	prog->len = len;					\
	prog->nodes[0] = node;					\
	memcpy(&prog->nodes[1], &in0->nodes[0], in0->len); 	\
	for (i = 0; i < MAXCASE; ++i)				\
		prog->out[i] = in0->out[i] sfx;			\
	make_known(prog);					\
} while(0)

	for (tree_iter_for(t0, all[len - 1])) {
		in0 = tree_prog(t0.here);
		unary_case(I_SHL1, << 1);
		unary_case(I_SHR1, >> 1);
		unary_case(I_SHR4, >> 4);
		unary_case(I_SHR16, >> 16);
		unary_case(I_NOT, ^ ~0);
	}
}

static void
binary_cases(int len) {
	tree_iter t0, t1;
	const struct prog *in0, *in1;
	struct prog *prog;
	int i, leftlen;

#define binary_case(node, infix) do {					\
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
		for (tree_iter_for(t0, all[leftlen])) {
			in0 = tree_prog(t0.here);
			for (tree_iter_for(t1, all[len - 1 - leftlen])) {
				in1 = tree_prog(t1.here);
				binary_case(I_AND, &);
				binary_case(I_OR, |);
				binary_case(I_XOR, ^);
				binary_case(I_PLUS, +);
			}
		}
}

static void ternary_cases(int len) {
	tree_iter t0, t1, t2;
	const struct prog *in0, *in1, *in2;
	struct prog *prog;
	int i, len0, len1;

	for (len0 = 1; len0 < len - 2; ++len0)
		for (tree_iter_for(t0, all[len0])) {
			in0 = tree_prog(t0.here);
			for (len1 = 1; len1 < len - 1 - len0; ++len1)
				for (tree_iter_for(t1, all[len1])) {
					in1 = tree_prog(t1.here);
					for (tree_iter_for(t2, all[len - 1 - len0 - len1])) {
						in2 = tree_prog(t2.here);
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
	int fd;
	char *rp;
	size_t s;
	ssize_t r;

	fd = open("/dev/urandom", O_RDONLY);
	for (rp = (char*)&xs, s = sizeof(xs); s > 0; rp += r, s -= r) {
		r = read(fd, rp, s);
		if (r <= 0)
			abort();
	}
//	for (i = 0; i < HASHCASE; ++i)
//		fprintf(stderr, "x = 0x%016"PRIx64"\n", xs[i]);

	cases_upto(10);
	return 0;
}
