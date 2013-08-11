CC = gcc
CFLAGS = -Wall -Werror -O3 -g -ljemalloc

all: flood foldflood

flood: flood.c
	$(CC) $(CFLAGS) $< -o $@
foldflood: flood.c
	$(CC) $(CFLAGS) -DFOLDED $< -o $@

clean:
	rm -f flood foldflood
