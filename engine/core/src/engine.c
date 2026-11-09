#include <stdlib.h>
#include <string.h>
#include "engine.h"

/* Every cell starts with `start_domain` as its possible values. */
bool	engine_init(t_engine *e, int ncells, t_set start_domain)
{
	memset(e, 0, sizeof(*e));
	e->ncells = ncells;
	e->domain = malloc(sizeof(t_set) * (size_t)ncells);
	e->support = malloc(sizeof(t_set) * (size_t)ncells);
	if (!e->domain || !e->support)
		return (engine_free(e), false);
	for (int c = 0; c < ncells; c++)
		e->domain[c] = start_domain;
	return (true);
}

void	engine_free(t_engine *e)
{
	for (int g = 0; g < e->ngroups; g++)
	{
		free(e->groups[g].cells);
		free(e->groups[g].values);
		free(e->groups[g].alive);
	}
	free(e->groups);
	free(e->domain);
	free(e->support);
	memset(e, 0, sizeof(*e));
}

/* Declares a group of cells. Returns its number, or -1 on failure. */
int	engine_add_group(t_engine *e, const int *cells, int len)
{
	t_group	*g;

	if (len < 1 || len > MAX_GROUP_LEN)
		return (-1);
	if (e->ngroups == e->group_cap)
	{
		int		cap = e->group_cap ? e->group_cap * 2 : 16;
		t_group	*groups = realloc(e->groups, sizeof(t_group) * (size_t)cap);

		if (!groups)
			return (-1);
		e->groups = groups;
		e->group_cap = cap;
	}
	g = &e->groups[e->ngroups];
	memset(g, 0, sizeof(*g));
	g->len = len;
	g->cells = malloc(sizeof(int) * (size_t)len);
	if (!g->cells)
		return (-1);
	memcpy(g->cells, cells, sizeof(int) * (size_t)len);
	return (e->ngroups++);
}

/* Adds one way of filling group g: values[i] goes in the group's i-th cell. */
bool	engine_add_candidate(t_engine *e, int gi, const uint8_t *values)
{
	t_group	*g = &e->groups[gi];

	if (g->count == g->capacity)
	{
		int		cap = g->capacity ? g->capacity * 2 : 16;
		uint8_t	*v = realloc(g->values, (size_t)cap * (size_t)g->len);

		if (!v)
			return (false);
		g->values = v;
		g->capacity = cap;
	}
	memcpy(&g->values[(size_t)g->count * (size_t)g->len], values, (size_t)g->len);
	g->count++;
	return (true);
}

/*
 * Call once a group has all its candidates.
 *
 * Its candidates now say exactly which values it can put in each of its
 * cells, so those cells are narrowed right away. Groups built after this
 * one see the narrower cells and save fewer candidates. (This is the
 * "check before saving" step from the Skyscrapers version.)
 */
bool	engine_finish_group(t_engine *e, int gi)
{
	t_group	*g = &e->groups[gi];
	t_set	used[MAX_GROUP_LEN] = {0};

	g->alive = malloc(g->count ? (size_t)g->count : 1);
	if (!g->alive)
		return (false);
	memset(g->alive, true, (size_t)g->count);
	g->alive_count = g->count;
	for (int k = 0; k < g->count; k++)
		for (int i = 0; i < g->len; i++)
			used[i] |= BIT(g->values[k * g->len + i]);
	for (int i = 0; i < g->len; i++)
		e->domain[g->cells[i]] &= used[i];
	return (true);
}

int	engine_total_alive(const t_engine *e)
{
	int	total = 0;

	for (int g = 0; g < e->ngroups; g++)
		total += e->groups[g].alive_count;
	return (total);
}
