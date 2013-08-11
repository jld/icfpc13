CC = gcc
CFLAGS = -Wall -Werror -O3 -g -ljemalloc
SRCS = flood.c siphash24.c
HDRS = siphash24.h

all: flood foldflood

flood: $(SRCS) $(HDRS)
	$(CC) $(CFLAGS) $(SRCS) -o $@
foldflood: $(SRCS) $(HDRS)
	$(CC) $(CFLAGS) -DFOLDED $(SRCS) -o $@

clean:
	rm -f flood foldflood
