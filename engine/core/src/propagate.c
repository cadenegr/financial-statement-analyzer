#include <stdio.h>
#include <stdlib.h>
#include "engine.h"

/*
 * Part 1 of a round: for every cell, which values do the candidates of each
 * of its groups put there? Keep only values that ALL its groups agree on.
 *
 * In Skyscrapers every cell is in 2 groups (its row and its column); in
 * Sudoku it would be 3 (row, column, box). The code doesn't care how many.
 */
static void	update_domains(t_engine *e)
{
	t_set	*support = e->support;

	for (int c = 0; c < e->ncells; c++)
		support[c] = ~(t_set)0;
	for (int gi = 0; gi < e->ngroups; gi++)
	{
		t_group	*g = &e->groups[gi];
		t_set	used[MAX_GROUP_LEN] = {0};

		for (int k = 0; k < g->count; k++)
		{
			if (!g->alive[k])
				continue ;
			for (int i = 0; i < g->len; i++)
				used[i] |= BIT(g->values[k * g->len + i]);
		}
		for (int i = 0; i < g->len; i++)
			support[g->cells[i]] &= used[i];
	}
	for (int c = 0; c < e->ncells; c++)
		e->domain[c] &= support[c];
}

/*
 * Part 2 of a round: rule out every candidate that puts a value in a cell
 * that no longer allows it. Returns how many were ruled out.
 */
static int	remove_candidates(t_engine *e)
{
	int	removed = 0;

	for (int gi = 0; gi < e->ngroups; gi++)
	{
		t_group	*g = &e->groups[gi];

		for (int k = 0; k < g->count; k++)
		{
			if (!g->alive[k])
				continue ;
			for (int i = 0; i < g->len; i++)
			{
				if (!HAS(e->domain[g->cells[i]], g->values[k * g->len + i]))
				{
					g->alive[k] = false;
					g->alive_count--;
					removed++;
					break ;
				}
			}
		}
	}
	return (removed);
}

/*
 * Runs rounds until nothing changes, then reports SOLVED, STUCK or
 * IMPOSSIBLE. This is the loop from your build_result(), plus the
 * "did anything change?" check that stops it from looping forever.
 */
t_result	engine_propagate(t_engine *e, bool verbose)
{
	int	round = 0;

	while (1)
	{
		int	removed;

		update_domains(e);
		removed = remove_candidates(e);
		round++;
		if (verbose)
			printf("  round %d: removed %d, %d candidates left\n",
				round, removed, engine_total_alive(e));
		for (int g = 0; g < e->ngroups; g++)
			if (e->groups[g].alive_count == 0)
				return (IMPOSSIBLE);
		if (removed == 0)
			break ;
	}
	for (int g = 0; g < e->ngroups; g++)
		if (e->groups[g].alive_count != 1)
			return (STUCK);
	return (SOLVED);
}
