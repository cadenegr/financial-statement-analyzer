#include <stdlib.h>
#include <string.h>
#include "engine.h"

/*
 * Step 3: guessing.
 *
 * When propagation is STUCK, some group still has several candidates. We
 * pick one, pretend it is the answer, and propagate again:
 *   - IMPOSSIBLE: that candidate was wrong, undo and try the next one;
 *   - SOLVED:     we found a solution;
 *   - STUCK:      still not sure, so guess again one level deeper.
 *
 * "Undo" means putting the puzzle back exactly as it was before the guess.
 * That is what the snapshot is for.
 */

/* Everything propagation changes: the cell domains and the alive flags. */
typedef struct s_snapshot
{
	t_set	*domain;
	int		*alive_count;
	bool	**alive;
}	t_snapshot;

static void	drop(const t_engine *e, t_snapshot *s)
{
	if (s->alive)
		for (int g = 0; g < e->ngroups; g++)
			free(s->alive[g]);
	free(s->alive);
	free(s->alive_count);
	free(s->domain);
}

static bool	save(const t_engine *e, t_snapshot *s)
{
	s->domain = malloc(sizeof(t_set) * (size_t)e->ncells);
	s->alive_count = malloc(sizeof(int) * (size_t)e->ngroups);
	s->alive = calloc((size_t)e->ngroups, sizeof(bool *));
	if (!s->domain || !s->alive_count || !s->alive)
		return (drop(e, s), false);
	memcpy(s->domain, e->domain, sizeof(t_set) * (size_t)e->ncells);
	for (int g = 0; g < e->ngroups; g++)
	{
		const t_group	*grp = &e->groups[g];

		s->alive_count[g] = grp->alive_count;
		s->alive[g] = malloc(grp->count ? (size_t)grp->count : 1);
		if (!s->alive[g])
			return (drop(e, s), false);
		memcpy(s->alive[g], grp->alive, (size_t)grp->count);
	}
	return (true);
}

static void	restore(t_engine *e, const t_snapshot *s)
{
	memcpy(e->domain, s->domain, sizeof(t_set) * (size_t)e->ncells);
	for (int g = 0; g < e->ngroups; g++)
	{
		e->groups[g].alive_count = s->alive_count[g];
		memcpy(e->groups[g].alive, s->alive[g], (size_t)e->groups[g].count);
	}
}

/*
 * Which group to guess on: the one with the fewest candidates left (but
 * more than one). With 2 candidates, one of our 2 guesses must be right.
 */
static int	pick_group(const t_engine *e)
{
	int	best = -1;

	for (int g = 0; g < e->ngroups; g++)
	{
		int	count = e->groups[g].alive_count;

		if (count > 1 && (best < 0 || count < e->groups[best].alive_count))
			best = g;
	}
	return (best);
}

/* Copies the solved cells (one value left in each) into the next slot. */
static void	record(const t_engine *e, t_solutions *s)
{
	uint8_t	*out = &s->grid[(size_t)s->found * (size_t)e->ncells];

	for (int c = 0; c < e->ncells; c++)
	{
		out[c] = 0;
		for (int v = 0; v <= MAX_VALUE; v++)
		{
			if (HAS(e->domain[c], v))
			{
				out[c] = (uint8_t)v;
				break ;
			}
		}
	}
	s->found++;
}

/* Returns false only if we ran out of memory. */
static bool	search(t_engine *e, t_solutions *s)
{
	t_result	result = engine_propagate(e, false);
	t_snapshot	snap = {0};
	t_group		*g;
	int			gi;

	if (result == IMPOSSIBLE)
		return (true);
	if (result == SOLVED)
	{
		record(e, s);
		return (true);
	}
	gi = pick_group(e);
	g = &e->groups[gi];
	if (!save(e, &snap))
		return (false);
	for (int k = 0; k < g->count && s->found < s->max; k++)
	{
		if (!snap.alive[gi][k])
			continue ;
		restore(e, &snap);
		memset(g->alive, false, (size_t)g->count);	/* the guess: */
		g->alive[k] = true;							/* only k is left */
		g->alive_count = 1;
		s->guesses++;
		if (!search(e, s))
			return (drop(e, &snap), false);
	}
	restore(e, &snap);
	drop(e, &snap);
	return (true);
}

/*
 * Finds up to max_solutions solutions; s->found says how many.
 * With max_solutions = 2: 0 = no solution, 1 = unique, 2 = more than one.
 * Returns false only if we ran out of memory.
 */
bool	engine_solve(t_engine *e, t_solutions *s, int max_solutions)
{
	s->max = max_solutions;
	s->found = 0;
	s->guesses = 0;
	s->grid = malloc((size_t)max_solutions * (size_t)e->ncells);
	if (!s->grid)
		return (false);
	return (search(e, s));
}

void	solutions_free(t_solutions *s)
{
	free(s->grid);
	s->grid = NULL;
}
