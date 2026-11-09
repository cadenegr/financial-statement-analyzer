#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "engine.h"

/*
 * The map plug-in for the engine core (core/, copied from
 * github.com/cadenegr/skyscrapers). Copied unchanged from deutsch-sarge-drill
 * (engine/sentence/main.c), where it finds German sentences; here it finds the
 * sign (+, -, ignored) each account carries into its parent.
 *
 * It knows nothing about the problem. It reads the map from a file, the core
 * solves it, and it prints every solution as numbers, one per line.
 *
 * Map file (written by scripts/pipeline/4-engine.mjs):
 *
 *   # a comment
 *   cells 4                  how many cells (slots)
 *   domain 3 2               cell 3 may only be 2 (a slot the sample fixes)
 *   domain 0 1 4 7           cell 0 may be 1, 4 or 7
 *   group 0 3                a group over cells 0 and 3, then its candidates,
 *   0 1                      one per line: a value for each cell of the group
 *   2 0
 *   end
 *
 * Output on stdout: "solutions N", then N lines of cell values.
 */

#define MAX_CELLS	64
#define LINE_LEN	1024

static int	parse_ints(const char *s, int *out, int max)
{
	int	n = 0;

	while (*s)
	{
		char	*end;
		long	v;

		while (isspace((unsigned char)*s))
			s++;
		if (!*s || *s == '#')
			break ;
		v = strtol(s, &end, 10);
		if (end == s || n == max)
			return (-1);
		out[n++] = (int)v;
		s = end;
	}
	return (n);
}

static bool	fail(int line, const char *msg)
{
	fprintf(stderr, "Error: map line %d: %s\n", line, msg);
	return (false);
}

/* Reads the map into the engine. Every value is checked before it is used. */
static bool	read_map(FILE *f, t_engine *e, bool *ready)
{
	char	buf[LINE_LEN];
	int		nums[MAX_GROUP_LEN + 1];
	int		line = 0;
	int		group = -1;		/* the group being filled, or -1 */
	int		glen = 0;

	*ready = false;
	while (fgets(buf, sizeof(buf), f))
	{
		char	*s = buf;
		int		n;

		line++;
		if (!strchr(buf, '\n') && !feof(f))
			return (fail(line, "line too long"));
		while (isspace((unsigned char)*s))
			s++;
		if (*s == '\0' || *s == '#')
			continue ;
		if (strncmp(s, "cells", 5) == 0)
		{
			if (*ready)
				return (fail(line, "\"cells\" given twice"));
			n = parse_ints(s + 5, nums, 1);
			if (n != 1 || nums[0] < 1 || nums[0] > MAX_CELLS)
				return (fail(line, "\"cells N\" needs N from 1 to 64"));
			if (!engine_init(e, nums[0], (t_set)~0u))
				return (fail(line, "out of memory"));
			*ready = true;
		}
		else if (!*ready)
			return (fail(line, "the map must start with \"cells N\""));
		else if (strncmp(s, "domain", 6) == 0)
		{
			t_set	set = 0;

			n = parse_ints(s + 6, nums, MAX_VALUE + 2);
			if (n < 2 || nums[0] < 0 || nums[0] >= e->ncells)
				return (fail(line, "\"domain CELL VALUE...\" needs a cell and at least one value"));
			for (int i = 1; i < n; i++)
			{
				if (nums[i] < 0 || nums[i] > MAX_VALUE)
					return (fail(line, "values go from 0 to 31"));
				set |= BIT(nums[i]);
			}
			e->domain[nums[0]] &= set;
		}
		else if (strncmp(s, "group", 5) == 0)
		{
			if (group >= 0)
				return (fail(line, "\"group\" before the last one's \"end\""));
			glen = parse_ints(s + 5, nums, MAX_GROUP_LEN);
			if (glen < 1)
				return (fail(line, "\"group CELL...\" needs 1 to 64 cells"));
			for (int i = 0; i < glen; i++)
				if (nums[i] < 0 || nums[i] >= e->ncells)
					return (fail(line, "no such cell"));
			group = engine_add_group(e, nums, glen);
			if (group < 0)
				return (fail(line, "out of memory"));
		}
		else if (strncmp(s, "end", 3) == 0)
		{
			if (group < 0)
				return (fail(line, "\"end\" without \"group\""));
			if (!engine_finish_group(e, group))
				return (fail(line, "out of memory"));
			group = -1;
		}
		else if (isdigit((unsigned char)*s))
		{
			uint8_t	vals[MAX_GROUP_LEN];

			if (group < 0)
				return (fail(line, "a candidate outside a group"));
			if (parse_ints(s, nums, MAX_GROUP_LEN) != glen)
				return (fail(line, "a candidate needs one value per cell of its group"));
			for (int i = 0; i < glen; i++)
			{
				if (nums[i] < 0 || nums[i] > MAX_VALUE)
					return (fail(line, "values go from 0 to 31"));
				vals[i] = (uint8_t)nums[i];
			}
			if (!engine_add_candidate(e, group, vals))
				return (fail(line, "out of memory"));
		}
		else
			return (fail(line, "unknown line (cells, domain, group, a candidate, end)"));
	}
	if (!*ready)
		return (fail(line, "empty map"));
	if (group >= 0)
		return (fail(line, "the last group has no \"end\""));
	return (true);
}

int	main(int argc, char **argv)
{
	t_engine	e = {0};
	t_solutions	s = {0};
	FILE		*f;
	bool		ready;
	bool		ok;
	long		max = 1000;

	if (argc < 2 || argc > 3)
	{
		fprintf(stderr, "Usage: %s MAP_FILE [MAX_SOLUTIONS]\n"
			"  MAP_FILE \"-\" reads the map from standard input; MAX_SOLUTIONS defaults to 1000\n",
			argv[0]);
		return (EXIT_FAILURE);
	}
	if (argc == 3)
	{
		char	*end;

		max = strtol(argv[2], &end, 10);
		if (*end || max < 1 || max > 1000000)
			return (fprintf(stderr, "Error: MAX_SOLUTIONS goes from 1 to 1000000.\n"), EXIT_FAILURE);
	}
	f = strcmp(argv[1], "-") == 0 ? stdin : fopen(argv[1], "r");
	if (!f)
		return (perror(argv[1]), EXIT_FAILURE);
	ok = read_map(f, &e, &ready);
	if (f != stdin)
		fclose(f);
	if (ok)
		ok = engine_solve(&e, &s, (int)max);
	if (!ok)
	{
		if (ready)
			engine_free(&e);
		return (solutions_free(&s), EXIT_FAILURE);
	}
	printf("solutions %d\n", s.found);
	for (int k = 0; k < s.found; k++)
		for (int c = 0; c < e.ncells; c++)
			printf("%d%c", s.grid[(size_t)k * (size_t)e.ncells + (size_t)c], c + 1 < e.ncells ? ' ' : '\n');
	fprintf(stderr, "%d solution%s, %ld guesses%s\n", s.found, s.found == 1 ? "" : "s", s.guesses,
		s.found == max ? " (stopped at the maximum: there may be more)" : "");
	solutions_free(&s);
	engine_free(&e);
	return (EXIT_SUCCESS);
}
