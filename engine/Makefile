# The map solver: the engine core (copied, see core/README.md) plus the map
# plug-in (copied from deutsch-sarge-drill). Build: make -C engine

CC      = cc
CFLAGS  = -Wall -Wextra -Werror -std=c99 -O2 -Icore/include
SRC     = $(wildcard core/src/*.c) map/main.c
OBJ     = $(SRC:%.c=obj/%.o)
NAME    = map-engine

all: $(NAME)

$(NAME): $(OBJ)
	$(CC) $(CFLAGS) -o $@ $(OBJ)

obj/%.o: %.c core/include/engine.h
	@mkdir -p $(dir $@)
	$(CC) $(CFLAGS) -c $< -o $@

clean:
	rm -rf obj

fclean: clean
	rm -f $(NAME)

re: fclean all

.PHONY: all clean fclean re
