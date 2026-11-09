#ifndef ENGINE_H
#define ENGINE_H

#include <stdbool.h>
#include <stdint.h>

/*
 * The solving engine, with no puzzle rules inside it.
 *
 * A puzzle is described as:
 *   - cells, each holding one value from 0 to 31;
 *   - groups of cells (a row, a column, a Sudoku box, a crossword slot...),
 *     each with a list of candidates: every way the group could be filled.
 *
 * The engine then does what your Skyscrapers solver did, for any puzzle:
 *   - groups that share a cell filter each other's candidates (propagate);
 *   - when that gets stuck, it guesses (solve).
 *
 * A plug-in (see puzzles/) only has to say which cells form a group and
 * which candidates each group has.
 */

/*
 * A set of values, one bit per value: bit v set means value v is possible.
 * 32 bits, so values go from 0 to 31 (enough for heights, digits, letters).
 */
typedef uint32_t	t_set;

#define MAX_VALUE		31
#define MAX_GROUP_LEN	64		/* most cells one group can have */
#define BIT(v)			((t_set)1u << (v))
#define HAS(set, v)		(((set) & BIT(v)) != 0)

typedef struct s_group
{
	int		len;			/* how many cells */
	int		*cells;			/* which cells, in order */
	int		count;			/* how many candidates */
	int		capacity;
	uint8_t	*values;		/* candidate k: values[k * len] .. values[k * len + len - 1] */
	bool	*alive;			/* alive[k] is false once candidate k is ruled out */
	int		alive_count;
}	t_group;

typedef struct s_engine
{
	int		ncells;
	t_set	*domain;		/* domain[c]: values cell c may still hold */
	t_set	*support;		/* work space for propagate, one per cell */
	int		ngroups;
	int		group_cap;
	t_group	*groups;
}	t_engine;

typedef enum e_result
{
	SOLVED,			/* every group has exactly one candidate left */
	STUCK,			/* nothing changes any more, but some groups still have several */
	IMPOSSIBLE		/* some group ran out of candidates: no solution */
}	t_result;

typedef struct s_solutions
{
	int		max;		/* stop after finding this many */
	int		found;
	uint8_t	*grid;		/* solution i: grid[i * ncells] .. grid[i * ncells + ncells - 1] */
	long	guesses;	/* how many candidates were tried */
}	t_solutions;

/* engine.c: building a puzzle */
bool		engine_init(t_engine *e, int ncells, t_set start_domain);
void		engine_free(t_engine *e);
int			engine_add_group(t_engine *e, const int *cells, int len);
bool		engine_add_candidate(t_engine *e, int g, const uint8_t *values);
bool		engine_finish_group(t_engine *e, int g);
int			engine_total_alive(const t_engine *e);

/* propagate.c: step 2 */
t_result	engine_propagate(t_engine *e, bool verbose);

/* search.c: step 3 */
bool		engine_solve(t_engine *e, t_solutions *s, int max_solutions);
void		solutions_free(t_solutions *s);

#endif
