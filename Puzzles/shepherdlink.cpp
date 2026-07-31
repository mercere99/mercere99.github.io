// shepherdlink.cpp — ShepherdLink: Slitherlink with sheep and wolves.
//
// In addition to number clues 0..3, cells may hold a sheep (must end up
// INSIDE the fence) or a wolf (must end up OUTSIDE). Cells carry an
// inside/outside/unknown state that interacts with the fence through parity:
// a fence separates inside from outside; the absence of one joins like sides;
// the world beyond the grid border is outside.
//
// Build (WebAssembly):
//   emcc -O2 -std=c++2b shepherdlink.cpp -o shepherdlink_wasm.js \
//        -sMODULARIZE=1 -sEXPORT_NAME=createShepherdModule -sSINGLE_FILE=1 \
//        -sEXPORTED_FUNCTIONS=_generate_shepherd,_shepherd_hint,_evaluate_shepherd \
//        -sEXPORTED_RUNTIME_METHODS=ccall,cwrap -sENVIRONMENT=web,node -sFILESYSTEM=0
//
// Build (native test):
//   g++ -O2 -std=c++23 -DNATIVE_TEST shepherdlink.cpp -o shepherd_test && ./shepherd_test
//
// Technique ladder (TECHS[]):
//   1 Clue counting   2 Dot rules      3 Fence parity   4 Corner reasoning
//   5 3-3 patterns    6 No early loop  7 One-step trial
//
// Clue encoding: -1 none, 0..3 numbers, 4 sheep, 5 wolf.
// Edge states: 0 unknown, 1 line, 2 cross.
// Cell states: 0 unknown, 1 inside, 2 outside.

#include <algorithm>
#include <array>
#include <cstdint>
#include <random>
#include <string>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

// std::expected where available (C++23); otherwise an API-compatible subset.
#if __has_include(<expected>)
#include <expected>
template <class T, class E> using Expected = std::expected<T, E>;
template <class E> using Unexpected = std::unexpected<E>;
#else
template <class E> struct Unexpected { E error; explicit Unexpected(E e) : error(e) {} };
template <class T, class E>
class Expected {
  bool ok_; T val_{}; E err_{};
 public:
  Expected(T v) : ok_(true), val_(std::move(v)) {}
  Expected(Unexpected<E> u) : ok_(false), err_(u.error) {}
  bool has_value() const { return ok_; }
  explicit operator bool() const { return ok_; }
  T& value() { return val_; }
  const T& value() const { return val_; }
  E& error() { return err_; }
  const E& error() const { return err_; }
  T* operator->() { return &val_; }
  const T* operator->() const { return &val_; }
  T& operator*() { return val_; }
  const T& operator*() const { return val_; }
};
#endif

// Public profiling types (returned by the evaluation API below).
struct Step { int tech, count; };
struct Profile {
  std::vector<Step> steps;
  bool solved_logically = false;
  int hardest = 0, total = 0;
};

/// Failure modes of evaluate_puzzle.
enum class EvalError {
  InvalidInstance,       // bad dimensions or clue values
  NoSolution,            // no single loop satisfies clues and animals
  MultipleSolutions,     // more than one does
  SearchLimitExceeded,   // solver hit its node budget before deciding
};

// ------------------------- board dimensions (runtime) -----------------------
constexpr int MAXR = 16, MAXC = 16;
constexpr int MAXNC = MAXR * MAXC;
constexpr int MAXE = (MAXR + 1) * MAXC + MAXR * (MAXC + 1);
constexpr int MAXNV = (MAXR + 1) * (MAXC + 1);
int R = 7, C = 7, NC = 49;
int NHE = 56, NVE = 56, E = 112, NV = 64;

// Clue values.
constexpr int8_t SHEEP = 4, WOLF = 5;

namespace {

inline int he(int r, int c) { return r * C + c; }
inline int ve(int r, int c) { return NHE + r * (C + 1) + c; }
inline int vid(int r, int c) { return r * (C + 1) + c; }

struct Tables {
  std::array<std::array<int, 4>, MAXNC> cellEdge{};    // top,bottom,left,right
  std::array<std::array<int, 4>, MAXNV> vertEdge{};    // up,down,left,right (-1)
  std::array<std::array<int, 2>, MAXE>  edgeVert{};
  std::array<std::array<int, 2>, MAXE>  edgeCell{};    // -1 = beyond the border
  struct Corner { int v; int at[2]; int away[2]; int opp; };
  std::array<std::array<Corner, 4>, MAXNC> corner{};

  void rebuild() {
    for (auto& a : vertEdge) a = {-1, -1, -1, -1};
    for (auto& a : edgeCell) a = {-1, -1};
    for (int r = 0; r < R; ++r)
      for (int c = 0; c < C; ++c) {
        int i = r * C + c;
        int T_ = he(r, c), B = he(r + 1, c), L = ve(r, c), Rt = ve(r, c + 1);
        cellEdge[i] = {T_, B, L, Rt};
        corner[i][0] = {vid(r, c),         {T_, L},  {B, Rt}, 3};
        corner[i][1] = {vid(r, c + 1),     {T_, Rt}, {B, L},  2};
        corner[i][2] = {vid(r + 1, c),     {B, L},  {T_, Rt}, 1};
        corner[i][3] = {vid(r + 1, c + 1), {B, Rt}, {T_, L},  0};
      }
    for (int r = 0; r <= R; ++r)
      for (int c = 0; c < C; ++c) {
        int e = he(r, c);
        edgeVert[e] = {vid(r, c), vid(r, c + 1)};
        if (r > 0) edgeCell[e][0] = (r - 1) * C + c;
        if (r < R) edgeCell[e][1] = r * C + c;
      }
    for (int r = 0; r < R; ++r)
      for (int c = 0; c <= C; ++c) {
        int e = ve(r, c);
        edgeVert[e] = {vid(r, c), vid(r + 1, c)};
        if (c > 0) edgeCell[e][0] = r * C + (c - 1);
        if (c < C) edgeCell[e][1] = r * C + c;
      }
    for (int r = 0; r <= R; ++r)
      for (int c = 0; c <= C; ++c) {
        int v = vid(r, c);
        if (r > 0) vertEdge[v][0] = ve(r - 1, c);
        if (r < R) vertEdge[v][1] = ve(r, c);
        if (c > 0) vertEdge[v][2] = he(r, c - 1);
        if (c < C) vertEdge[v][3] = he(r, c);
      }
  }
};
Tables make_tables() { Tables t; t.rebuild(); return t; }
Tables T = make_tables();

}  // namespace

void set_dims(int rows, int cols) {
  R = std::max(4, std::min(MAXR, rows));
  C = std::max(4, std::min(MAXC, cols));
  NC = R * C;
  NHE = (R + 1) * C;
  NVE = R * (C + 1);
  E = NHE + NVE;
  NV = (R + 1) * (C + 1);
  T.rebuild();
}

using EdgeSt = std::array<uint8_t, MAXE>;
using Clues  = std::array<int8_t, MAXNC>;

/// Full solving state: edge states plus inside/outside cell states.
struct Board {
  EdgeSt st{};                          // 0 unknown, 1 line, 2 cross
  std::array<uint8_t, MAXNC> cs{};      // 0 unknown, 1 inside, 2 outside
};

namespace {

bool is_number(int8_t c) { return c >= 0 && c <= 3; }
bool is_animal(int8_t c) { return c == SHEEP || c == WOLF; }

// The world beyond the border is always OUTSIDE.
uint8_t side_of(const Board& b, int cell) { return cell < 0 ? uint8_t(2) : b.cs[cell]; }

void init_board(Board& b, const Clues& clues) {
  b.st.fill(0);
  b.cs.fill(0);
  for (int i = 0; i < NC; ++i)
    if (clues[i] == SHEEP) b.cs[i] = 1;
    else if (clues[i] == WOLF) b.cs[i] = 2;
}

std::string cell_name(int i) { return "r" + std::to_string(i / C + 1) + "c" + std::to_string(i % C + 1); }
std::string edge_name(int e) {
  if (e < NHE) {
    int r = e / C, c = e % C;
    if (r == 0) return "the top edge of " + cell_name(c);
    if (r == R) return "the bottom edge of " + cell_name((R - 1) * C + c);
    return "the edge between " + cell_name((r - 1) * C + c) + " and " + cell_name(r * C + c);
  }
  int x = e - NHE, r = x / (C + 1), c = x % (C + 1);
  if (c == 0) return "the left edge of " + cell_name(r * C);
  if (c == C) return "the right edge of " + cell_name(r * C + C - 1);
  return "the edge between " + cell_name(r * C + c - 1) + " and " + cell_name(r * C + c);
}

// ---------------------------------------------------------- basic counting --
void cell_counts(const EdgeSt& st, int cell, int& lines, int& unk) {
  lines = unk = 0;
  for (int e : T.cellEdge[cell]) {
    if (st[e] == 1) ++lines;
    else if (st[e] == 0) ++unk;
  }
}
void vert_counts(const EdgeSt& st, int v, int& lines, int& unk) {
  lines = unk = 0;
  for (int e : T.vertEdge[v]) {
    if (e < 0) continue;
    if (st[e] == 1) ++lines;
    else if (st[e] == 0) ++unk;
  }
}

struct LineGraph {
  std::array<int, MAXNV> deg{};
  std::array<int, MAXE> comp;
  int ncomp = 0;
  int nlines = 0;
  LineGraph(const EdgeSt& st) {
    comp.fill(-1);
    for (int e = 0; e < E; ++e)
      if (st[e] == 1) {
        ++nlines;
        ++deg[T.edgeVert[e][0]];
        ++deg[T.edgeVert[e][1]];
      }
    for (int e0 = 0; e0 < E; ++e0) {
      if (st[e0] != 1 || comp[e0] >= 0) continue;
      int id = ncomp++;
      std::vector<int> stack{e0};
      comp[e0] = id;
      while (!stack.empty()) {
        int e = stack.back();
        stack.pop_back();
        for (int v : T.edgeVert[e])
          for (int e2 : T.vertEdge[v])
            if (e2 >= 0 && st[e2] == 1 && comp[e2] < 0) { comp[e2] = id; stack.push_back(e2); }
      }
    }
  }
  bool closed(const EdgeSt& st, int id) const {
    for (int e = 0; e < E; ++e)
      if (st[e] == 1 && comp[e] == id)
        for (int v : T.edgeVert[e])
          if (deg[v] != 2) return false;
    return true;
  }
};

// Is cell inside the drawn loop? Ray to the left, counting crossed lines.
bool geom_inside(const EdgeSt& st, int cell) {
  int r = cell / C, c = cell % C, cnt = 0;
  for (int cc = 0; cc <= c; ++cc)
    if (st[ve(r, cc)] == 1) ++cnt;
  return cnt & 1;
}

// Full-assignment validation: single closed loop, number clues exact, dots
// 0/2, sheep inside, wolves outside.
bool full_valid(const EdgeSt& st, const Clues& clues) {
  for (int v = 0; v < NV; ++v) {
    int l, u;
    vert_counts(st, v, l, u);
    if (u || (l != 0 && l != 2)) return false;
  }
  for (int i = 0; i < NC; ++i) {
    if (!is_number(clues[i])) continue;
    int l, u;
    cell_counts(st, i, l, u);
    if (u || l != clues[i]) return false;
  }
  LineGraph G(st);
  if (!(G.nlines > 0 && G.ncomp == 1 && G.closed(st, 0))) return false;
  for (int i = 0; i < NC; ++i) {
    if (clues[i] == SHEEP && !geom_inside(st, i)) return false;
    if (clues[i] == WOLF && geom_inside(st, i)) return false;
  }
  return true;
}

// ------------------------------------------------------------- propagation --
// Cell/dot counting, closed-cycle contradiction detection, and fence parity:
//   line  edge => opposite sides;  cross edge => same side;
//   both sides known => the edge is forced;  beyond the border is outside.
// Returns false on contradiction.
bool propagate(Board& b, const Clues& clues) {
  EdgeSt& st = b.st;
  bool changed = true;
  while (changed) {
    changed = false;
    for (int i = 0; i < NC; ++i) {
      if (!is_number(clues[i])) continue;
      int l, u;
      cell_counts(st, i, l, u);
      if (l > clues[i] || l + u < clues[i]) return false;
      if (!u) continue;
      if (l == clues[i]) {
        for (int e : T.cellEdge[i])
          if (st[e] == 0) { st[e] = 2; changed = true; }
      } else if (l + u == clues[i]) {
        for (int e : T.cellEdge[i])
          if (st[e] == 0) { st[e] = 1; changed = true; }
      }
    }
    for (int v = 0; v < NV; ++v) {
      int l, u;
      vert_counts(st, v, l, u);
      if (l > 2) return false;
      if (l == 1 && u == 0) return false;
      if (u == 0) continue;
      if (l == 2) {
        for (int e : T.vertEdge[v])
          if (e >= 0 && st[e] == 0) { st[e] = 2; changed = true; }
      } else if (l == 1 && u == 1) {
        for (int e : T.vertEdge[v])
          if (e >= 0 && st[e] == 0) { st[e] = 1; changed = true; }
      } else if (l == 0 && u == 1) {
        for (int e : T.vertEdge[v])
          if (e >= 0 && st[e] == 0) { st[e] = 2; changed = true; }
      }
    }
    // fence parity
    for (int e = 0; e < E; ++e) {
      int a = T.edgeCell[e][0], c = T.edgeCell[e][1];
      uint8_t sa = side_of(b, a), sc = side_of(b, c);
      if (st[e] == 1) {
        if (sa && sc) { if (sa == sc) return false; }
        else if (sa && c >= 0) { b.cs[c] = uint8_t(3 - sa); changed = true; }
        else if (sc && a >= 0) { b.cs[a] = uint8_t(3 - sc); changed = true; }
      } else if (st[e] == 2) {
        if (sa && sc) { if (sa != sc) return false; }
        else if (sa && c >= 0) { b.cs[c] = sa; changed = true; }
        else if (sc && a >= 0) { b.cs[a] = sc; changed = true; }
      } else if (sa && sc) {
        st[e] = (sa == sc) ? 2 : 1;
        changed = true;
      }
    }
    LineGraph G(st);
    for (int id = 0; id < G.ncomp; ++id) {
      if (!G.closed(st, id)) continue;
      int cyc = 0;
      for (int e = 0; e < E; ++e)
        if (st[e] == 1 && G.comp[e] == id) ++cyc;
      if (cyc != G.nlines) return false;
      for (int i = 0; i < NC; ++i) {
        if (!is_number(clues[i])) continue;
        int l, u;
        cell_counts(st, i, l, u);
        if (l != clues[i]) return false;
      }
      // the loop is final: animals must be on the right side of it
      {
        EdgeSt done = st;
        for (int e = 0; e < E; ++e)
          if (done[e] == 0) done[e] = 2;
        for (int i = 0; i < NC; ++i) {
          if (clues[i] == SHEEP && !geom_inside(done, i)) return false;
          if (clues[i] == WOLF && geom_inside(done, i)) return false;
        }
      }
      for (int e = 0; e < E; ++e)
        if (st[e] == 0) { st[e] = 2; changed = true; }
    }
  }
  return true;
}

// --------------------------------------------------- solver / solution count --
int count_sol(const Clues& clues, int limit, long& nodes, long cap, bool& capped,
              EdgeSt* witness = nullptr) {
  Board b;
  init_board(b, clues);
  auto rec = [&](auto&& self, Board s, int lim) -> int {
    if (++nodes > cap) { capped = true; return lim; }
    if (!propagate(s, clues)) return 0;
    int pick = -1, best = -1;
    for (int e = 0; e < E; ++e) {
      if (s.st[e] != 0) continue;
      int score = 0;
      for (int cc : T.edgeCell[e])
        if (cc >= 0 && clues[cc] >= 0) score += 2;
      for (int v : T.edgeVert[e]) {
        int l, u;
        vert_counts(s.st, v, l, u);
        score += l;
      }
      if (score > best) { best = score; pick = e; }
    }
    if (pick < 0) {
      if (!full_valid(s.st, clues)) return 0;
      if (witness) *witness = s.st;
      return 1;
    }
    int total = 0;
    for (uint8_t val : {uint8_t(1), uint8_t(2)}) {
      Board s2 = s;
      s2.st[pick] = val;
      total += self(self, s2, lim - total);
      if (total >= lim) break;
    }
    return total;
  };
  return rec(rec, b, limit);
}

// ------------------------------------------------------- solution generation --
bool gen_loop(std::array<uint8_t, MAXNC>& in, std::mt19937& rng) {
  in.fill(0);
  int start = int(rng() % NC);
  in[start] = 1;
  int size = 1, target = NC * 2 / 5 + int(rng() % std::max(1, NC / 4));
  auto inAt = [&](int r, int c) -> bool {
    return r >= 0 && r < R && c >= 0 && c < C && in[r * C + c];
  };
  for (int guard = 0; guard < 4000 && size < target; ++guard) {
    std::vector<int> frontier;
    for (int i = 0; i < NC; ++i) {
      if (in[i]) continue;
      int r = i / C, c = i % C;
      if (inAt(r - 1, c) || inAt(r + 1, c) || inAt(r, c - 1) || inAt(r, c + 1))
        frontier.push_back(i);
    }
    if (frontier.empty()) break;
    std::shuffle(frontier.begin(), frontier.end(), rng);
    bool grew = false;
    for (int cand : frontier) {
      int r = cand / C, c = cand % C;
      bool bad = false;
      for (int dr : {-1, 1})
        for (int dc : {-1, 1})
          if (inAt(r + dr, c + dc) && !inAt(r + dr, c) && !inAt(r, c + dc)) bad = true;
      if (bad) continue;
      in[cand] = 1;
      std::array<uint8_t, MAXNC> seen{};
      std::vector<int> stack;
      for (int i = 0; i < NC; ++i) {
        int rr = i / C, cc = i % C;
        if (!in[i] && (rr == 0 || rr == R - 1 || cc == 0 || cc == C - 1) && !seen[i]) {
          seen[i] = 1;
          stack.push_back(i);
        }
      }
      while (!stack.empty()) {
        int i = stack.back();
        stack.pop_back();
        int rr = i / C, cc = i % C;
        const int dr[4] = {-1, 1, 0, 0}, dc[4] = {0, 0, -1, 1};
        for (int k = 0; k < 4; ++k) {
          int r2 = rr + dr[k], c2 = cc + dc[k];
          if (r2 < 0 || r2 >= R || c2 < 0 || c2 >= C) continue;
          int j = r2 * C + c2;
          if (!in[j] && !seen[j]) { seen[j] = 1; stack.push_back(j); }
        }
      }
      bool hole = false;
      for (int i = 0; i < NC; ++i)
        if (!in[i] && !seen[i]) hole = true;
      if (hole) { in[cand] = 0; continue; }
      ++size;
      grew = true;
      break;
    }
    if (!grew) break;
  }
  if (size < NC / 5 || size >= NC) return false;
  EdgeSt st{};
  auto inCell = [&](int cell) { return cell >= 0 && in[cell]; };
  for (int e = 0; e < E; ++e) {
    bool a = inCell(T.edgeCell[e][0]), b = inCell(T.edgeCell[e][1]);
    st[e] = (a != b) ? 1 : 2;
  }
  for (int v = 0; v < NV; ++v) {
    int l, u;
    vert_counts(st, v, l, u);
    if (l != 0 && l != 2) return false;
  }
  return true;
}

void solution_edges(const std::array<uint8_t, MAXNC>& in, EdgeSt& st) {
  auto inCell = [&](int cell) { return cell >= 0 && in[cell]; };
  for (int e = 0; e < E; ++e) {
    bool a = inCell(T.edgeCell[e][0]), b = inCell(T.edgeCell[e][1]);
    st[e] = (a != b) ? 1 : 2;
  }
}

}  // namespace

// -------------------------------------------------------------- techniques --
namespace {

bool g_desc = false;

struct Act { int edge; uint8_t state; };
struct CellAct { int cell; uint8_t state; };
struct Found {
  std::vector<Act>     acts;
  std::vector<CellAct> cellActs;
  std::vector<int>     pattern_edges;
  std::vector<int>     pattern_cells;
  std::string          desc;
};

void dedupe(std::vector<Found>& fs) {
  std::vector<Found> out;
  std::vector<std::pair<std::vector<Act>, std::vector<CellAct>>> seen;
  for (auto& f : fs) {
    std::sort(f.acts.begin(), f.acts.end(), [](const Act& a, const Act& b) {
      return a.edge != b.edge ? a.edge < b.edge : a.state < b.state;
    });
    std::sort(f.cellActs.begin(), f.cellActs.end(), [](const CellAct& a, const CellAct& b) {
      return a.cell != b.cell ? a.cell < b.cell : a.state < b.state;
    });
    bool dup = false;
    for (const auto& s : seen)
      if (s.first.size() == f.acts.size() && s.second.size() == f.cellActs.size() &&
          std::equal(s.first.begin(), s.first.end(), f.acts.begin(),
                     [](const Act& a, const Act& b) { return a.edge == b.edge && a.state == b.state; }) &&
          std::equal(s.second.begin(), s.second.end(), f.cellActs.begin(),
                     [](const CellAct& a, const CellAct& b) { return a.cell == b.cell && a.state == b.state; }))
        { dup = true; break; }
    if (dup) continue;
    seen.push_back({f.acts, f.cellActs});
    out.push_back(std::move(f));
  }
  fs = std::move(out);
}

int apply_founds(Board& b, const std::vector<Found>& fs) {
  for (const auto& f : fs) {
    for (const auto& a : f.acts)
      if (b.st[a.edge] == 0) b.st[a.edge] = a.state;
    for (const auto& a : f.cellActs)
      if (b.cs[a.cell] == 0) b.cs[a.cell] = a.state;
  }
  return int(fs.size());
}

const char* side_word(uint8_t s) { return s == 1 ? "inside" : "outside"; }

// -- 1: clue counting -----------------------------------------------------------
void scan_cell(const Board& b, const Clues& clues, std::vector<Found>& out) {
  for (int i = 0; i < NC; ++i) {
    if (!is_number(clues[i])) continue;
    int l, u;
    cell_counts(b.st, i, l, u);
    if (!u) continue;
    Found f;
    if (l == clues[i]) {
      for (int e : T.cellEdge[i])
        if (b.st[e] == 0) f.acts.push_back({e, 2});
      if (g_desc)
        f.desc = cell_name(i) + " already has its " + std::to_string(int(clues[i])) +
                 " fence segment(s), so its remaining edges are ruled out.";
    } else if (l + u == clues[i]) {
      for (int e : T.cellEdge[i])
        if (b.st[e] == 0) f.acts.push_back({e, 1});
      if (g_desc)
        f.desc = cell_name(i) + " needs every undecided edge to reach its clue of " +
                 std::to_string(int(clues[i])) + ".";
    }
    if (f.acts.empty()) continue;
    f.pattern_cells = {i};
    out.push_back(std::move(f));
  }
}

// -- 2: dot rules -----------------------------------------------------------------
void scan_vertex(const Board& b, const Clues&, std::vector<Found>& out) {
  for (int v = 0; v < NV; ++v) {
    int l, u;
    vert_counts(b.st, v, l, u);
    if (!u) continue;
    Found f;
    const char* why = nullptr;
    if (l == 2) {
      for (int e : T.vertEdge[v])
        if (e >= 0 && b.st[e] == 0) f.acts.push_back({e, 2});
      why = "already meets two fence segments, so no more may join it";
    } else if (l == 1 && u == 1) {
      for (int e : T.vertEdge[v])
        if (e >= 0 && b.st[e] == 0) f.acts.push_back({e, 1});
      why = "has one fence segment and one open edge — the fence must continue through it";
    } else if (l == 0 && u == 1) {
      for (int e : T.vertEdge[v])
        if (e >= 0 && b.st[e] == 0) f.acts.push_back({e, 2});
      why = "has one open edge and no fence — a lone dead end is impossible";
    }
    if (f.acts.empty()) continue;
    for (int e : T.vertEdge[v])
      if (e >= 0 && b.st[e] != 0) f.pattern_edges.push_back(e);
    if (g_desc)
      f.desc = "The dot at (" + std::to_string(v / (C + 1)) + "," +
               std::to_string(v % (C + 1)) + ") " + why + ".";
    out.push_back(std::move(f));
  }
}

// -- 3: fence parity ----------------------------------------------------------------
// A fence separates inside from outside; no fence joins like sides; the world
// beyond the border is outside. Each single deduction is one instance:
//   - known edge + one known side  => the other side
//   - two known sides + open edge  => the edge
void scan_parity(const Board& b, const Clues&, std::vector<Found>& out) {
  for (int e = 0; e < E; ++e) {
    int a = T.edgeCell[e][0], c = T.edgeCell[e][1];
    uint8_t sa = side_of(b, a), sc = side_of(b, c);
    Found f;
    if (b.st[e] == 1) {
      if (sa && !sc && c >= 0) {
        f.cellActs.push_back({c, uint8_t(3 - sa)});
        if (g_desc)
          f.desc = std::string("A fence separates the two sides: ") +
                   (a < 0 ? "the far side of this border fence" : cell_name(a) + " (" + side_word(sa) + ")") +
                   " puts " + cell_name(c) + " " + side_word(uint8_t(3 - sa)) + " the pen.";
      } else if (sc && !sa && a >= 0) {
        f.cellActs.push_back({a, uint8_t(3 - sc)});
        if (g_desc)
          f.desc = std::string("A fence separates the two sides: ") +
                   (c < 0 ? "the far side of this border fence" : cell_name(c) + " (" + side_word(sc) + ")") +
                   " puts " + cell_name(a) + " " + side_word(uint8_t(3 - sc)) + " the pen.";
      }
    } else if (b.st[e] == 2) {
      if (sa && !sc && c >= 0) {
        f.cellActs.push_back({c, sa});
        if (g_desc)
          f.desc = "No fence crosses between them, so " + cell_name(c) + " is on the same side as " +
                   (a < 0 ? std::string("the world beyond the border (outside)") : cell_name(a) + " (" + side_word(sa) + ")") + ".";
      } else if (sc && !sa && a >= 0) {
        f.cellActs.push_back({a, sc});
        if (g_desc)
          f.desc = "No fence crosses between them, so " + cell_name(a) + " is on the same side as " +
                   (c < 0 ? std::string("the world beyond the border (outside)") : cell_name(c) + " (" + side_word(sc) + ")") + ".";
      }
    } else if (sa && sc) {
      f.acts.push_back({e, uint8_t(sa == sc ? 2 : 1)});
      if (g_desc) {
        std::string an = a < 0 ? "the border (outside)" : cell_name(a) + " (" + side_word(sa) + ")";
        std::string cn = c < 0 ? "the border (outside)" : cell_name(c) + " (" + side_word(sc) + ")";
        f.desc = sa == sc
                     ? an + " and " + cn + " are on the same side, so no fence runs between them."
                     : an + " and " + cn + " are on different sides, so a fence must run between them.";
      }
    }
    if (f.acts.empty() && f.cellActs.empty()) continue;
    f.pattern_edges.push_back(e);
    if (a >= 0) f.pattern_cells.push_back(a);
    if (c >= 0) f.pattern_cells.push_back(c);
    out.push_back(std::move(f));
  }
}

// -- 4: corner reasoning -----------------------------------------------------------
void scan_corner(const Board& b, const Clues& clues, std::vector<Found>& out) {
  auto ext_of = [&](int cell, int k, int ext[2]) {
    const auto& co = T.corner[cell][k];
    int n = 0;
    for (int e : T.vertEdge[co.v]) {
      if (e < 0) continue;
      if (e == co.at[0] || e == co.at[1]) continue;
      ext[n++] = e;
    }
    while (n < 2) ext[n++] = -1;
  };
  auto stx = [&](int e) -> uint8_t { return e < 0 ? uint8_t(2) : b.st[e]; };

  for (int i = 0; i < NC; ++i) {
    if (!is_number(clues[i])) continue;
    for (int k = 0; k < 4; ++k) {
      const auto& co = T.corner[i][k];
      int ext[2];
      ext_of(i, k, ext);
      uint8_t a = stx(ext[0]), b2 = stx(ext[1]);
      bool both_cross = (a == 2 && b2 == 2);
      bool line_in = (a == 1 && b2 == 2) || (a == 2 && b2 == 1);
      Found f;
      if (both_cross && clues[i] == 3) {
        for (int e : co.at)
          if (b.st[e] == 0) f.acts.push_back({e, 1});
        if (g_desc && !f.acts.empty())
          f.desc = "Nothing can pass outside this corner of the 3 at " + cell_name(i) +
                   ", so both of its corner edges must carry the fence.";
      } else if (both_cross && clues[i] == 1) {
        for (int e : co.at)
          if (b.st[e] == 0) f.acts.push_back({e, 2});
        if (g_desc && !f.acts.empty())
          f.desc = "A fence entering this corner of the 1 at " + cell_name(i) +
                   " couldn't leave, so both corner edges are ruled out.";
      } else if (line_in && clues[i] == 3) {
        for (int e : co.away)
          if (b.st[e] == 0) f.acts.push_back({e, 1});
        if (g_desc && !f.acts.empty())
          f.desc = "A fence enters a corner of the 3 at " + cell_name(i) +
                   " and uses exactly one of its corner edges — the two far edges must both be fence.";
      } else if (line_in && clues[i] == 1) {
        for (int e : co.away)
          if (b.st[e] == 0) f.acts.push_back({e, 2});
        if (g_desc && !f.acts.empty())
          f.desc = "A fence enters a corner of the 1 at " + cell_name(i) +
                   " and spends its single segment there — the two far edges are ruled out.";
      } else if (both_cross && clues[i] == 2) {
        for (int kk = 0; kk < 4; ++kk) {
          if (kk == k || kk == co.opp) continue;
          int e2[2];
          ext_of(i, kk, e2);
          uint8_t x = stx(e2[0]), y = stx(e2[1]);
          if (x == 2 && y == 0) f.acts.push_back({e2[1], 1});
          else if (y == 2 && x == 0) f.acts.push_back({e2[0], 1});
          else if (x == 1 && y == 0) f.acts.push_back({e2[1], 2});
          else if (y == 1 && x == 0) f.acts.push_back({e2[0], 2});
        }
        if (g_desc && !f.acts.empty())
          f.desc = "With this corner of the 2 at " + cell_name(i) +
                   " sealed off, exactly one external edge at each adjacent corner carries the fence.";
      } else if (line_in && clues[i] == 2) {
        int e2[2];
        ext_of(i, co.opp, e2);
        uint8_t x = stx(e2[0]), y = stx(e2[1]);
        if (x == 2 && y == 0) f.acts.push_back({e2[1], 1});
        else if (y == 2 && x == 0) f.acts.push_back({e2[0], 1});
        else if (x == 1 && y == 0) f.acts.push_back({e2[1], 2});
        else if (y == 1 && x == 0) f.acts.push_back({e2[0], 2});
        if (g_desc && !f.acts.empty())
          f.desc = "A fence enters one corner of the 2 at " + cell_name(i) +
                   ", so it must exit through the opposite corner.";
      }
      if (f.acts.empty()) continue;
      f.pattern_cells = {i};
      for (int e : {ext[0], ext[1]})
        if (e >= 0) f.pattern_edges.push_back(e);
      out.push_back(std::move(f));
    }
  }
}

// -- 5: 3-3 patterns -----------------------------------------------------------------
void scan_threes(const Board& b, const Clues& clues, std::vector<Found>& out) {
  auto add = [&](Found& f, int e, uint8_t v) {
    if (e >= 0 && b.st[e] == 0) f.acts.push_back({e, v});
  };
  for (int r = 0; r < R; ++r)
    for (int c = 0; c < C; ++c) {
      int i = r * C + c;
      if (clues[i] != 3) continue;
      if (c + 1 < C && clues[i + 1] == 3) {
        Found f;
        add(f, ve(r, c), 1);
        add(f, ve(r, c + 1), 1);
        add(f, ve(r, c + 2), 1);
        if (r > 0) add(f, ve(r - 1, c + 1), 2);
        if (r + 1 < R) add(f, ve(r + 1, c + 1), 2);
        if (!f.acts.empty()) {
          f.pattern_cells = {i, i + 1};
          if (g_desc)
            f.desc = "Adjacent 3s at " + cell_name(i) + " and " + cell_name(i + 1) +
                     ": the shared and outer vertical edges are fence, and the shared edge cannot extend.";
          out.push_back(std::move(f));
        }
      }
      if (r + 1 < R && clues[i + C] == 3) {
        Found f;
        add(f, he(r, c), 1);
        add(f, he(r + 1, c), 1);
        add(f, he(r + 2, c), 1);
        if (c > 0) add(f, he(r + 1, c - 1), 2);
        if (c + 1 < C) add(f, he(r + 1, c + 1), 2);
        if (!f.acts.empty()) {
          f.pattern_cells = {i, i + C};
          if (g_desc)
            f.desc = "Stacked 3s at " + cell_name(i) + " and " + cell_name(i + C) +
                     ": the shared and outer horizontal edges are fence, and the shared edge cannot extend.";
          out.push_back(std::move(f));
        }
      }
      if (r + 1 < R && c + 1 < C && clues[i + C + 1] == 3) {
        Found f;
        add(f, he(r, c), 1);
        add(f, ve(r, c), 1);
        add(f, he(r + 2, c + 1), 1);
        add(f, ve(r + 1, c + 2), 1);
        if (!f.acts.empty()) {
          f.pattern_cells = {i, i + C + 1};
          if (g_desc)
            f.desc = "Diagonal 3s at " + cell_name(i) + " and " + cell_name(i + C + 1) +
                     ": their outer corners must carry the fence.";
          out.push_back(std::move(f));
        }
      }
      if (r + 1 < R && c > 0 && clues[i + C - 1] == 3) {
        Found f;
        add(f, he(r, c), 1);
        add(f, ve(r, c + 1), 1);
        add(f, he(r + 2, c - 1), 1);
        add(f, ve(r + 1, c - 1), 1);
        if (!f.acts.empty()) {
          f.pattern_cells = {i, i + C - 1};
          if (g_desc)
            f.desc = "Diagonal 3s at " + cell_name(i) + " and " + cell_name(i + C - 1) +
                     ": their outer corners must carry the fence.";
          out.push_back(std::move(f));
        }
      }
    }
}

// -- 6: no early loop -----------------------------------------------------------------
void scan_closure(const Board& b, const Clues& clues, std::vector<Found>& out) {
  std::array<int, MAXNV> uf;
  for (int v = 0; v < NV; ++v) uf[v] = v;
  auto find = [&](int v) { while (uf[v] != v) v = uf[v] = uf[uf[v]]; return v; };
  bool any_line = false;
  for (int e = 0; e < E; ++e)
    if (b.st[e] == 1) {
      any_line = true;
      int x = find(T.edgeVert[e][0]), y = find(T.edgeVert[e][1]);
      if (x != y) uf[x] = y;
    }
  if (!any_line) return;
  for (int e = 0; e < E; ++e) {
    if (b.st[e] != 0) continue;
    if (find(T.edgeVert[e][0]) != find(T.edgeVert[e][1])) continue;
    EdgeSt sim = b.st;
    sim[e] = 1;
    for (int x = 0; x < E; ++x)
      if (sim[x] == 0) sim[x] = 2;
    if (full_valid(sim, clues)) continue;
    Found f;
    f.acts.push_back({e, 2});
    f.pattern_edges = {e};
    if (g_desc)
      f.desc = "Drawing " + edge_name(e) +
               " would close the fence before the flock is sorted out, so it must stay empty.";
    out.push_back(std::move(f));
  }
}

// -- 7: one-step trial ------------------------------------------------------------------
// Try a single edge (fence/no-fence) or a single unknown cell (inside/outside)
// and propagate the counting, dot, and parity rules; a contradiction forces
// the opposite.
void scan_trial(const Board& b, const Clues& clues, std::vector<Found>& out) {
  for (int e = 0; e < E; ++e) {
    if (b.st[e] != 0) continue;
    for (uint8_t v : {uint8_t(1), uint8_t(2)}) {
      Board b2 = b;
      b2.st[e] = v;
      if (propagate(b2, clues)) continue;
      Found f;
      f.acts.push_back({e, uint8_t(3 - v)});
      f.pattern_edges = {e};
      if (g_desc)
        f.desc = "Suppose " + edge_name(e) + " were " + (v == 1 ? "a fence" : "empty") +
                 ": the rules quickly run into a contradiction, so it must be the opposite.";
      out.push_back(std::move(f));
      break;
    }
  }
  for (int i = 0; i < NC; ++i) {
    if (b.cs[i] != 0) continue;
    for (uint8_t v : {uint8_t(1), uint8_t(2)}) {
      Board b2 = b;
      b2.cs[i] = v;
      if (propagate(b2, clues)) continue;
      Found f;
      f.cellActs.push_back({i, uint8_t(3 - v)});
      f.pattern_cells = {i};
      if (g_desc)
        f.desc = "Suppose " + cell_name(i) + " were " + side_word(v) +
                 " the pen: the rules quickly run into a contradiction, so it must be " +
                 side_word(uint8_t(3 - v)) + ".";
      out.push_back(std::move(f));
      break;
    }
  }
}

// ------------------------------------------------------------ technique table --
struct Tech { const char* name; void (*scan)(const Board&, const Clues&, std::vector<Found>&); };
constexpr int NUM_TECH = 7;
const std::array<Tech, NUM_TECH + 1> TECHS = {{
    {"", nullptr},
    {"Clue counting",    scan_cell},     // 1
    {"Dot rules",        scan_vertex},   // 2
    {"Fence parity",     scan_parity},   // 3
    {"Corner reasoning", scan_corner},   // 4
    {"3-3 patterns",     scan_threes},   // 5
    {"No early loop",    scan_closure},  // 6
    {"One-step trial",   scan_trial},    // 7
}};

int run_tech(int t, Board& b, const Clues& clues) {
  std::vector<Found> fs;
  TECHS[t].scan(b, clues, fs);
  dedupe(fs);
  return apply_founds(b, fs);
}

bool board_solved(const Board& b, const Clues& clues) {
  for (int i = 0; i < NC; ++i) {
    if (!is_number(clues[i])) continue;
    int l, u;
    cell_counts(b.st, i, l, u);
    if (l != clues[i]) return false;
  }
  LineGraph G(b.st);
  if (!(G.nlines > 0 && G.ncomp == 1 && G.closed(b.st, 0))) return false;
  EdgeSt done = b.st;
  for (int e = 0; e < E; ++e)
    if (done[e] == 0) done[e] = 2;
  for (int i = 0; i < NC; ++i) {
    if (clues[i] == SHEEP && !geom_inside(done, i)) return false;
    if (clues[i] == WOLF && geom_inside(done, i)) return false;
  }
  return true;
}

Profile profile_puzzle(const Clues& clues) {
  Board b;
  init_board(b, clues);
  Profile P;
  while (!board_solved(b, clues)) {
    int applied = 0, tier = 0;
    for (int t = 1; t <= NUM_TECH && !applied; ++t) { applied = run_tech(t, b, clues); tier = t; }
    if (!applied) break;
    P.steps.push_back({tier, applied});
    P.total += applied;
    P.hardest = std::max(P.hardest, tier);
    if (P.steps.size() > 2000) break;
  }
  P.solved_logically = board_solved(b, clues);
  return P;
}

// ---------------------------------------------------------------- generation --
struct LevelSpec {
  const char* name;
  int lo, hi;          // window on hardest tier
  int t7lo, t7hi;      // window on total one-step-trial applications,
                       //   calibrated for a 7x7 board and scaled by area
  int remove_pct;      // % of clues the removal pass may take before easing
  int max_attempts;
};
LevelSpec LEVELS[] = {
    {"Easy",   1, 3, 0, 0,    35, 30},
    {"Medium", 4, 5, 0, 0,    55, 30},
    {"Hard",   6, 7, 0, 3,    62, 30},
    {"Expert", 7, 7, 6, 999, 100, 40},
};
int t7_count(const Profile& P) {
  int n = 0;
  for (const auto& st : P.steps)
    if (st.tech == 7) n += st.count;
  return n;
}
int scale_t7(int per49) {
  if (per49 == 0 || per49 >= 999) return per49;
  return std::max(1, per49 * NC / 49);
}
bool in_window(const Profile& P, const LevelSpec& S) {
  if (!P.solved_logically || P.hardest < S.lo || P.hardest > S.hi) return false;
  int t7 = t7_count(P);
  return t7 >= scale_t7(S.t7lo) && t7 <= scale_t7(S.t7hi);
}

struct Generated {
  Clues clues{};
  EdgeSt solution{};
  std::array<uint8_t, MAXNC> inside{};
  Profile prof;
  int attempts = 0;
};

Generated generate_level_impl(int level, std::mt19937& rng) {
  const LevelSpec& S = LEVELS[level];
  Generated best;
  int best_score = 1 << 30;
  for (int att = 1; att <= S.max_attempts; ++att) {
    std::array<uint8_t, MAXNC> in{};
    if (!gen_loop(in, rng)) continue;
    EdgeSt sol{};
    solution_edges(in, sol);
    // Full assignment: numbers everywhere, then convert ~22% into animals.
    Clues original{};
    for (int i = 0; i < NC; ++i) {
      int n = 0;
      for (int e : T.cellEdge[i])
        if (sol[e] == 1) ++n;
      original[i] = int8_t(n);
    }
    for (int i = 0; i < NC; ++i)
      if (rng() % 100 < 22) original[i] = in[i] ? SHEEP : WOLF;
    Clues clues = original;
    std::vector<int> removed;
    std::array<int, MAXNC> order{};
    for (int i = 0; i < NC; ++i) order[i] = i;
    std::shuffle(order.begin(), order.begin() + NC, rng);
    int remove_cap = NC * S.remove_pct / 100;
    for (int k = 0; k < NC; ++k) {
      int i = order[k];
      if (int(removed.size()) >= remove_cap) break;
      int8_t keep = clues[i];
      clues[i] = -1;
      long nodes = 0;
      bool capped = false;
      if (count_sol(clues, 2, nodes, 150000, capped) != 1 || capped) clues[i] = keep;
      else removed.push_back(i);
    }
    Profile P = profile_puzzle(clues);
    auto below = [&](const Profile& p) {
      return p.solved_logically &&
             (p.hardest < S.lo ||
              (p.hardest <= S.hi && t7_count(p) < scale_t7(S.t7lo)));
    };
    std::shuffle(removed.begin(), removed.end(), rng);
    while (!removed.empty()) {
      if (in_window(P, S)) break;
      if (below(P)) break;
      int i = removed.back();
      removed.pop_back();
      Clues c2 = clues;
      c2[i] = original[i];
      Profile P2 = profile_puzzle(c2);
      if (below(P2) && !in_window(P2, S)) continue;
      clues = c2;
      P = P2;
    }
    bool in_win = in_window(P, S);
    int t7d = std::max(0, std::max(scale_t7(S.t7lo) - t7_count(P), t7_count(P) - scale_t7(S.t7hi)));
    int score = in_win ? 0
              : (P.solved_logically ? 1 + std::abs(P.hardest - (S.lo + S.hi) / 2) + t7d
                                    : 1000);
    if (score < best_score) {
      best_score = score;
      best.clues = clues;
      best.solution = sol;
      best.inside = in;
      best.prof = P;
      best.attempts = att;
      if (score == 0) break;
    }
  }
  return best;
}

// ---------------------------------------------------------------------- JSON --
void append_profile_json(std::string& out, const Profile& P) {
  std::array<int, NUM_TECH + 1> summary{};
  out += "\"profile\":[";
  for (size_t i = 0; i < P.steps.size(); ++i) {
    if (i) out += ',';
    out += '[' + std::to_string(P.steps[i].tech) + ',' + std::to_string(P.steps[i].count) + ']';
    summary[P.steps[i].tech] += P.steps[i].count;
  }
  out += "],\"summary\":{";
  bool first = true;
  for (int t = 1; t <= NUM_TECH; ++t)
    if (summary[t]) {
      if (!first) out += ',';
      first = false;
      out += '"' + std::to_string(t) + "\":" + std::to_string(summary[t]);
    }
  out += "},\"techNames\":[";
  for (int t = 0; t <= NUM_TECH; ++t) {
    if (t) out += ',';
    out += '"';
    out += TECHS[t].name;
    out += '"';
  }
  out += "],\"hardest\":" + std::to_string(P.hardest);
  out += ",\"totalSteps\":" + std::to_string(P.total);
  out += ",\"solvedLogically\":";
  out += P.solved_logically ? "true" : "false";
}

void append_ints(std::string& out, const char* key, const std::vector<int>& v) {
  out += '"';
  out += key;
  out += "\":[";
  for (size_t i = 0; i < v.size(); ++i) {
    if (i) out += ',';
    out += std::to_string(v[i]);
  }
  out += ']';
}

Clues g_clues{};
EdgeSt g_solution{};
std::array<uint8_t, MAXNC> g_inside{};
std::string g_result;

}  // namespace

// ========================== public evaluation API ===========================
/// Evaluate an arbitrary ShepherdLink instance and produce its difficulty
/// profile.
///
/// Intended entry point for external puzzle-generation research: hand it a
/// candidate instance; it returns the full solving Profile or the reason the
/// instance is unusable.
///
/// IMPORTANT: the engine's board dimensions (R, C) are process-global. Call
/// set_dims(rows, cols) BEFORE building the clue array; clues are row-major
/// over R*C cells with -1 = none, 0..3 = number, 4 = sheep (must end inside
/// the fence), 5 = wolf (must end outside). The string-based
/// evaluate_shepherd() export handles sizing automatically and restores the
/// previous dimensions.
///
/// @param clues row-major clue array for the current dimensions.
/// @param search_cap node budget for the uniqueness search.
/// @return the Profile from the 7-tier technique ladder (see TECHS), or:
///         - EvalError::InvalidInstance     a clue outside -1..5
///         - EvalError::NoSolution          no single loop fits clues+animals
///         - EvalError::MultipleSolutions   at least two loops fit
///         - EvalError::SearchLimitExceeded search_cap hit before deciding
///
/// Profile.solved_logically == false means the instance is valid (unique)
/// but needs case analysis beyond the ladder; hardest/steps still describe
/// how far the ladder gets.
Expected<Profile, EvalError> evaluate_puzzle(const Clues& clues,
                                             long long search_cap = 5000000) {
  for (int i = 0; i < NC; ++i)
    if (clues[i] < -1 || clues[i] > 5)
      return Unexpected<EvalError>(EvalError::InvalidInstance);
  long nodes = 0;
  bool capped = false;
  int n = count_sol(clues, 2, nodes, search_cap, capped);
  if (capped) return Unexpected<EvalError>(EvalError::SearchLimitExceeded);
  if (n == 0) return Unexpected<EvalError>(EvalError::NoSolution);
  if (n >= 2) return Unexpected<EvalError>(EvalError::MultipleSolutions);
  return profile_puzzle(clues);
}

extern "C" {

EXPORT const char* generate_shepherd(int level, int rows, int cols, unsigned seed) {
  level = std::max(0, std::min(3, level));
  set_dims(rows, cols);
  std::mt19937 rng(seed);
  Generated G = generate_level_impl(level, rng);
  g_clues = G.clues;
  g_solution = G.solution;
  g_inside = G.inside;
  g_result = "{\"kind\":\"shepherdlink\",\"rows\":" + std::to_string(R) +
             ",\"cols\":" + std::to_string(C) + ",\"level\":\"";
  g_result += LEVELS[level].name;
  g_result += "\",\"attempts\":" + std::to_string(G.attempts) + ",\"clues\":[";
  for (int i = 0; i < NC; ++i) {
    if (i) g_result += ',';
    g_result += std::to_string(int(G.clues[i]));
  }
  g_result += "],\"solution\":\"";
  for (int e = 0; e < E; ++e) g_result += (G.solution[e] == 1 ? '1' : '0');
  g_result += "\",\"solutionInside\":\"";
  for (int i = 0; i < NC; ++i) g_result += (G.inside[i] ? '1' : '0');
  g_result += "\",";
  append_profile_json(g_result, G.prof);
  g_result += '}';
  return g_result.c_str();
}

// shepherd_hint(stateE, cellsNC): edge states '0'/'1'/'2' and the player's
// inside/outside cell marks '0'/'1'/'2'; uses the last generated puzzle.
EXPORT const char* shepherd_hint(const char* stateE, const char* cellsNC) {
  Board b;
  init_board(b, g_clues);
  for (int e = 0; e < E && stateE[e]; ++e)
    b.st[e] = (stateE[e] == '1') ? 1 : (stateE[e] == '2') ? 2 : 0;
  std::vector<int> badE, badC;
  for (int e = 0; e < E; ++e) {
    if (b.st[e] == 1 && g_solution[e] != 1) badE.push_back(e);
    if (b.st[e] == 2 && g_solution[e] == 1) badE.push_back(e);
  }
  for (int i = 0; i < NC && cellsNC[i]; ++i) {
    uint8_t m = (cellsNC[i] == '1') ? 1 : (cellsNC[i] == '2') ? 2 : 0;
    if (!m) continue;
    uint8_t truth = g_inside[i] ? 1 : 2;
    if (m != truth) badC.push_back(i);
    else if (!b.cs[i]) b.cs[i] = m;               // honor correct player marks
  }
  if (!badE.empty() || !badC.empty()) {
    g_result = "{\"error\":\"mistakes\",";
    append_ints(g_result, "edges", badE);
    g_result += ',';
    append_ints(g_result, "cells", badC);
    g_result += '}';
    return g_result.c_str();
  }
  if (board_solved(b, g_clues)) { g_result = "{\"error\":\"solved\"}"; return g_result.c_str(); }

  g_desc = true;
  for (int t = 1; t <= NUM_TECH; ++t) {
    std::vector<Found> fs;
    TECHS[t].scan(b, g_clues, fs);
    dedupe(fs);
    std::vector<Found> useful;
    for (auto& f : fs) {
      bool any = false;
      for (const auto& a : f.acts)
        if (b.st[a.edge] == 0) any = true;
      for (const auto& a : f.cellActs)
        if (b.cs[a.cell] == 0) any = true;
      if (any) useful.push_back(std::move(f));
    }
    if (useful.empty()) continue;
    const Found& f = useful.front();
    g_desc = false;
    g_result = "{\"tier\":" + std::to_string(t) + ",\"name\":\"" + TECHS[t].name +
               "\",\"desc\":\"" + f.desc + "\",";
    std::vector<int> ae, as, ce, cs;
    for (const auto& a : f.acts) { ae.push_back(a.edge); as.push_back(a.state); }
    for (const auto& a : f.cellActs) { ce.push_back(a.cell); cs.push_back(a.state); }
    append_ints(g_result, "actEdges", ae);
    g_result += ',';
    append_ints(g_result, "actStates", as);
    g_result += ',';
    append_ints(g_result, "actCells", ce);
    g_result += ',';
    append_ints(g_result, "actCellStates", cs);
    g_result += ',';
    append_ints(g_result, "patternEdges", f.pattern_edges);
    g_result += ',';
    append_ints(g_result, "patternCells", f.pattern_cells);
    g_result += '}';
    return g_result.c_str();
  }
  g_desc = false;
  g_result = "{\"error\":\"stuck\"}";
  return g_result.c_str();
}

// JSON wrapper around evaluate_puzzle. Spec: "R,C;c0,c1,..." with R*C clue
// values (-1 none, 0..3 numbers, 4 sheep, 5 wolf).
EXPORT const char* evaluate_shepherd(const char* spec) {
  int oldR = R, oldC = C;
  auto fail = [&](const char* what) {
    set_dims(oldR, oldC);
    g_result = std::string("{\"status\":\"") + what + "\"}";
    return g_result.c_str();
  };
  std::vector<long> nums;
  {
    long v = 0;
    bool have = false, neg = false;
    for (const char* p = spec;; ++p) {
      if (*p == '-') neg = true;
      else if (*p >= '0' && *p <= '9') { v = v * 10 + (*p - '0'); have = true; }
      else {
        if (have) nums.push_back(neg ? -v : v);
        v = 0; have = false; neg = false;
        if (*p == 0) break;
      }
    }
  }
  if (nums.size() < 2) return fail("invalid_instance");
  int r = int(nums[0]), c = int(nums[1]);
  if (r < 4 || r > MAXR || c < 4 || c > MAXC) return fail("invalid_instance");
  if (int(nums.size()) != 2 + r * c) return fail("invalid_instance");
  set_dims(r, c);
  Clues clues{};
  for (int i = 0; i < NC; ++i) clues[i] = int8_t(nums[2 + i]);
  auto res = evaluate_puzzle(clues);
  if (!res) {
    switch (res.error()) {
      case EvalError::InvalidInstance:     return fail("invalid_instance");
      case EvalError::NoSolution:          return fail("no_solution");
      case EvalError::MultipleSolutions:   return fail("multiple_solutions");
      case EvalError::SearchLimitExceeded: return fail("search_limit_exceeded");
    }
  }
  g_result = "{\"status\":\"ok\",";
  append_profile_json(g_result, *res);
  g_result += '}';
  set_dims(oldR, oldC);
  return g_result.c_str();
}

}  // extern "C"

// ------------------------------------------------------------- native test --
#ifdef NATIVE_TEST
#include <chrono>
#include <cstdio>
int main() {
  // 1. per-technique soundness fuzz against known solutions (edges AND sides)
  {
    std::mt19937 rng(555);
    long fired[NUM_TECH + 1] = {};
    int puzzles = 0;
    while (puzzles < 40) {
      std::array<uint8_t, MAXNC> in{};
      if (!gen_loop(in, rng)) continue;
      EdgeSt sol{};
      solution_edges(in, sol);
      Clues clues{};
      for (int i = 0; i < NC; ++i) {
        int n = 0;
        for (int e : T.cellEdge[i])
          if (sol[e] == 1) ++n;
        clues[i] = int8_t(n);
      }
      for (int i = 0; i < NC; ++i)
        if (rng() % 100 < 25) clues[i] = in[i] ? SHEEP : WOLF;
      long nodes = 0;
      bool capped = false;
      if (count_sol(clues, 2, nodes, 300000, capped) != 1 || capped) continue;
      ++puzzles;
      for (int iter = 0; iter < 40; ++iter) {
        Board b;
        init_board(b, clues);
        for (int e = 0; e < E; ++e)
          if (rng() % 3 == 0) b.st[e] = sol[e];
        for (int i = 0; i < NC; ++i)
          if (!b.cs[i] && rng() % 4 == 0) b.cs[i] = in[i] ? 1 : 2;
        for (int tier = 1; tier <= NUM_TECH; ++tier) {
          Board b2 = b;
          fired[tier] += run_tech(tier, b2, clues);
          for (int e = 0; e < E; ++e)
            if (b2.st[e] != 0 && b.st[e] == 0 && b2.st[e] != sol[e]) {
              std::printf("tier %d WRONG EDGE ACTION\n", tier);
              return 1;
            }
          for (int i = 0; i < NC; ++i)
            if (b2.cs[i] != 0 && b.cs[i] == 0 && b2.cs[i] != (in[i] ? 1 : 2)) {
              std::printf("tier %d WRONG CELL ACTION\n", tier);
              return 1;
            }
        }
      }
    }
    for (int t = 1; t <= NUM_TECH; ++t)
      std::printf("tier %d %-17s: %ld sound actions\n", t, TECHS[t].name, fired[t]);
  }
  // 2. evaluator failure modes
  {
    std::mt19937 rng(3);
    set_dims(7, 7);
    Generated G = generate_level_impl(1, rng);
    auto ok = evaluate_puzzle(G.clues);
    std::printf("unique:   %s (hardest %d)\n", ok ? "profile" : "ERR", ok ? ok->hardest : -1);
    Clues bad = G.clues;
    // put a wolf where the solution is inside -> unsatisfiable
    for (int i = 0; i < NC; ++i)
      if (G.inside[i] && bad[i] == -1) { bad[i] = WOLF; break; }
    auto r2 = evaluate_puzzle(bad);
    std::printf("bad wolf: %s\n", !r2 && r2.error() == EvalError::NoSolution ? "no_solution" : "UNEXPECTED");
    Clues open{};
    for (int i = 0; i < NC; ++i) open[i] = -1;
    auto r3 = evaluate_puzzle(open);
    std::printf("all-open: %s\n", !r3 && r3.error() == EvalError::MultipleSolutions ? "multiple_solutions" : "UNEXPECTED");
    Clues inv = G.clues;
    inv[0] = 9;
    auto r4 = evaluate_puzzle(inv);
    std::printf("bad clue: %s\n", !r4 && r4.error() == EvalError::InvalidInstance ? "invalid_instance" : "UNEXPECTED");
  }
  // 3. level stats across sizes
  for (auto [rr, cc] : {std::pair{7, 7}, {10, 10}, {12, 12}}) {
    for (int level = 0; level < 4; ++level) {
      int hit = 0;
      long ms_total = 0, ms_max = 0;
      int n_puz = 3;
      long t7sum = 0;
      for (int t = 0; t < n_puz; ++t) {
        auto t0 = std::chrono::steady_clock::now();
        std::mt19937 r5(61000 + rr * 1000 + level * 100 + t);
        set_dims(rr, cc);
        Generated g = generate_level_impl(level, r5);
        long ms = std::chrono::duration_cast<std::chrono::milliseconds>(
                      std::chrono::steady_clock::now() - t0).count();
        ms_total += ms;
        ms_max = std::max(ms_max, ms);
        if (in_window(g.prof, LEVELS[level])) ++hit;
        t7sum += t7_count(g.prof);
        auto chk = evaluate_puzzle(g.clues);
        if (!chk) { std::printf("SHIPPED FAILED EVAL\n"); return 1; }
      }
      std::printf("%2dx%-2d %-7s: hit %d/%d, avg %ld ms, max %ld ms, avg t7 %ld\n",
                  rr, cc, LEVELS[level].name, hit, n_puz, ms_total / n_puz, ms_max, t7sum / n_puz);
      std::fflush(stdout);
    }
  }
  return 0;
}
#endif
