// sudoku.cpp — Sudoku generation, logical difficulty profiling, and hints.
//
// Build (WebAssembly):
//   emcc -O2 -std=c++2b sudoku.cpp -o sudoku_wasm.js \
//        -sMODULARIZE=1 -sEXPORT_NAME=createSudokuModule -sSINGLE_FILE=1 \
//        -sEXPORTED_FUNCTIONS=_generate,_generate_level,_profile_board,_hint \
//        -sEXPORTED_RUNTIME_METHODS=ccall,cwrap -sENVIRONMENT=web,node -sFILESYSTEM=0
//
// Build (native test):
//   g++ -O2 -std=c++23 -DNATIVE_TEST sudoku.cpp -o sudoku_test && ./sudoku_test
//
// Exports:
//   generate(target_clues, seed)      raw generation at a clue count (kept for experiments)
//   generate_level(level, seed)       profile-targeted generation; level 0..4
//   profile_board(board81)            difficulty profile of an arbitrary puzzle
//   hint(givens81, values81, elimCSV) easiest applicable technique for the current state
//
// Technique ladder (single table: TECHS[]; reorder there):
//    1 Naked single      2 Hidden single    3 Locked candidates
//    4 Naked pair        5 Hidden pair      6 Naked triple      7 Hidden triple
//    8 Naked quad        9 Hidden quad     10 X-Wing
//   11 Skyscraper/kite  12 XY-Wing         13 XYZ-Wing
//   14 Swordfish        15 Jellyfish

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <random>
#include <string>
#include <vector>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

// std::expected where available (C++23); otherwise an API-compatible subset
// so the public evaluation API keeps one signature everywhere (the Ubuntu
// emscripten 3.1.6 toolchain ships a libc++ without <expected>).
#if __has_include(<expected>)
#include <expected>
template <class T, class E> using Expected = std::expected<T, E>;
template <class E> using Unexpected = std::unexpected<E>;
#else
template <class E> struct Unexpected { E error; explicit Unexpected(E e) : error(e) {} };
template <class T, class E>
class Expected {
  bool ok_;
  T val_{};
  E err_{};
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
  std::vector<Step> steps;          // (tier, applications) in solving order
  bool solved_logically = false;    // did the ladder finish the puzzle?
  int  hardest = 0, total = 0;      // hardest tier used; total applications
};

/// Failure modes of evaluate_puzzle.
enum class EvalError {
  NoSolution,            // the clues admit no completion
  MultipleSolutions,     // more than one completion exists
  SearchLimitExceeded,   // solver hit its node budget before deciding
};

namespace {

// ----------------------------------------------------------------- basics --
using Mask = uint16_t;                        // candidate bitmask; bit d = digit d
constexpr Mask ALL = 0b1111111110;

inline int popcount(unsigned m)   { return __builtin_popcount(m); }
inline int lowest_bit(unsigned m) { return __builtin_ctz(m); }

struct CellSet {
  uint64_t lo = 0, hi = 0;                    // hi holds cells 64..80
  void     set(int i)        { (i < 64 ? lo : hi) |= 1ULL << (i & 63); }
  bool     test(int i) const { return ((i < 64 ? lo : hi) >> (i & 63)) & 1; }
  int      count()     const { return __builtin_popcountll(lo) + __builtin_popcountll(hi); }
  bool     empty()     const { return !lo && !hi; }
  CellSet  operator|(CellSet o) const { return {lo | o.lo, hi | o.hi}; }
  CellSet  operator&(CellSet o) const { return {lo & o.lo, hi & o.hi}; }
  CellSet  minus(CellSet o)     const { return {lo & ~o.lo, hi & ~o.hi}; }
  bool     subset_of(CellSet o) const { return !(lo & ~o.lo) && !(hi & ~o.hi); }
  bool     disjoint(CellSet o)  const { return !(lo & o.lo) && !(hi & o.hi); }
  template <class F> void for_each(F f) const {
    for (uint64_t a = lo; a; a &= a - 1) f(__builtin_ctzll(a));
    for (uint64_t a = hi; a; a &= a - 1) f(64 + __builtin_ctzll(a));
  }
};

// ---------------------------------------------------------------- regions --
// Region ids: 0-8 rows, 9-17 cols, 18-26 boxes.
struct Tables {
  std::array<std::array<int, 9>, 27>  region{};
  std::array<CellSet, 27>             region_set{};
  std::array<std::array<int, 20>, 81> peers{};
  std::array<CellSet, 81>             peer_set{};

  Tables() {
    for (int r = 0; r < 9; ++r)
      for (int c = 0; c < 9; ++c) {
        int i = r * 9 + c, b = (r / 3) * 3 + c / 3;
        region[r][c] = i;
        region[9 + c][r] = i;
        region[18 + b][(r % 3) * 3 + c % 3] = i;
      }
    for (int g = 0; g < 27; ++g)
      for (int i : region[g]) region_set[g].set(i);
    for (int i = 0; i < 81; ++i) {
      bool in[81] = {};
      int  r = i / 9, c = i % 9, b = 18 + (r / 3) * 3 + c / 3;
      for (int j : region[r])     in[j] = true;
      for (int j : region[9 + c]) in[j] = true;
      for (int j : region[b])     in[j] = true;
      in[i] = false;
      int n = 0;
      for (int j = 0; j < 81; ++j)
        if (in[j]) { peers[i][n++] = j; peer_set[i].set(j); }
    }
  }
};
const Tables T;

// ------------------------------------------------------------ name helpers --
bool g_desc = false;                          // build human descriptions? (hints only)

std::string cell_name(int i) { return "r" + std::to_string(i / 9 + 1) + "c" + std::to_string(i % 9 + 1); }
std::string region_name(int g) {
  if (g < 9)  return "row " + std::to_string(g + 1);
  if (g < 18) return "column " + std::to_string(g - 8);
  return "box " + std::to_string(g - 17);
}
std::string cells_list(const std::vector<int>& cs) {
  std::string s;
  for (size_t k = 0; k < cs.size(); ++k) { if (k) s += ", "; s += cell_name(cs[k]); }
  return s;
}

// ---------------------------------------------------------- solving state --
struct State {
  std::array<int, 81>  val{};
  std::array<Mask, 81> cand{};

  void init(const std::array<int, 81>& g) {
    val = g;
    for (int i = 0; i < 81; ++i) cand[i] = val[i] ? 0 : ALL;
    for (int i = 0; i < 81; ++i)
      if (val[i])
        for (int p : T.peers[i]) cand[p] &= ~Mask(1 << val[i]);
  }
  void place(int i, int d) {
    val[i] = d; cand[i] = 0;
    for (int p : T.peers[i]) cand[p] &= ~Mask(1 << d);
  }
  bool solved() const { for (int v : val) if (!v) return false; return true; }
  bool contradiction() const {
    for (int i = 0; i < 81; ++i) if (!val[i] && !cand[i]) return true;
    return false;
  }
  CellSet digit_cells(int d) const {
    CellSet s;
    for (int i = 0; i < 81; ++i) if (cand[i] & (1 << d)) s.set(i);
    return s;
  }
};

// ---------------------------------------------- uniqueness solver (MRV) ----
long long g_solver_nodes = 0;
long long g_solver_cap = 1LL << 60;
bool g_solver_capped = false;

int count_solutions(std::array<int, 81>& v, int limit) {
  if (++g_solver_nodes > g_solver_cap) { g_solver_capped = true; return limit; }
  int best = -1, best_n = 10;
  Mask best_m = 0;
  for (int i = 0; i < 81; ++i)
    if (!v[i]) {
      Mask used = 0;
      for (int p : T.peers[i]) used |= Mask(1 << v[p]);
      Mask m = ALL & ~used;
      int  n = popcount(m);
      if (!n) return 0;
      if (n < best_n) { best = i; best_m = m; best_n = n; if (n == 1) break; }
    }
  if (best < 0) return 1;
  int total = 0;
  for (Mask m = best_m; m; m &= m - 1) {
    v[best] = lowest_bit(m);
    total += count_solutions(v, limit - total);
    if (total >= limit) break;
  }
  v[best] = 0;
  return total;
}

bool fill_solved(std::array<int, 81>& v, std::mt19937& rng) {
  int best = -1, best_n = 10;
  Mask best_m = 0;
  for (int i = 0; i < 81; ++i)
    if (!v[i]) {
      Mask used = 0;
      for (int p : T.peers[i]) used |= Mask(1 << v[p]);
      Mask m = ALL & ~used;
      int  n = popcount(m);
      if (!n) return false;
      if (n < best_n) { best = i; best_m = m; best_n = n; }
    }
  if (best < 0) return true;
  std::array<int, 9> ds{};
  int nd = 0;
  for (Mask m = best_m; m; m &= m - 1) ds[nd++] = lowest_bit(m);
  std::shuffle(ds.begin(), ds.begin() + nd, rng);
  for (int k = 0; k < nd; ++k) {
    v[best] = ds[k];
    if (fill_solved(v, rng)) return true;
  }
  v[best] = 0;
  return false;
}

// -------------------------------------------------------------- symbols ----
// Display symbols for digits 1..9 (used only in human-facing descriptions;
// the engine always works with 1..9 internally).
std::array<std::string, 10> g_sym = {"", "1", "2", "3", "4", "5", "6", "7", "8", "9"};
const std::string& sym(int d) { return g_sym[d]; }
std::string sym_set(Mask m) {
  std::string s = "{";
  for (int d = 1; d <= 9; ++d)
    if (m & (1 << d)) { if (s.size() > 1) s += ","; s += sym(d); }
  return s + "}";
}

// ------------------------------------------------------------- techniques --
// Each scan reports pattern instances found in a frozen state.  An instance
// must be guaranteed progress: a placement, or >=1 candidate eliminated.
// Instances are de-duplicated (placements by cell, eliminations by their
// normalized elimination set) so counts reflect distinct useful applications;
// then all are applied at once.
struct Elim { int cell; Mask digits; };

struct Found {
  std::vector<int>  pattern;                  // cells forming the pattern
  std::vector<Elim> elims;                    // candidate removals
  int place_cell = -1, place_digit = 0;       // for singles
  std::string desc;                           // human explanation (hints)
};

void dedupe(std::vector<Found>& fs) {
  std::vector<Found> out;
  std::vector<std::vector<Elim>> seen;
  bool seen_place[81] = {};
  auto elim_less = [](const Elim& a, const Elim& b) {
    return a.cell != b.cell ? a.cell < b.cell : a.digits < b.digits;
  };
  for (auto& f : fs) {
    if (f.place_cell >= 0) {
      if (seen_place[f.place_cell]) continue;
      seen_place[f.place_cell] = true;
    } else {
      std::sort(f.elims.begin(), f.elims.end(), elim_less);
      bool dup = false;
      for (const auto& e : seen)
        if (e.size() == f.elims.size() &&
            std::equal(e.begin(), e.end(), f.elims.begin(),
                       [](const Elim& a, const Elim& b) {
                         return a.cell == b.cell && a.digits == b.digits;
                       })) { dup = true; break; }
      if (dup) continue;
      seen.push_back(f.elims);
    }
    out.push_back(std::move(f));
  }
  fs = std::move(out);
}

int apply_founds(State& s, const std::vector<Found>& fs) {
  for (const auto& f : fs) {
    if (f.place_cell >= 0) {
      if (!s.val[f.place_cell]) s.place(f.place_cell, f.place_digit);
    } else {
      for (const auto& e : f.elims) s.cand[e.cell] &= ~e.digits;
    }
  }
  return int(fs.size());
}

// -- 1: naked single ----------------------------------------------------------
void scan_naked_single(const State& s, std::vector<Found>& out) {
  for (int i = 0; i < 81; ++i)
    if (!s.val[i] && popcount(s.cand[i]) == 1) {
      Found f;
      f.place_cell = i;
      f.place_digit = lowest_bit(s.cand[i]);
      f.pattern = {i};
      if (g_desc)
        f.desc = cell_name(i) + " has only one possible digit: " +
                 sym(f.place_digit) + ".";
      out.push_back(std::move(f));
    }
}

// -- 2: hidden single ---------------------------------------------------------
void scan_hidden_single(const State& s, std::vector<Found>& out) {
  for (int g = 0; g < 27; ++g)
    for (int d = 1; d <= 9; ++d) {
      int n = 0, pos = -1;
      for (int i : T.region[g])
        if (s.cand[i] & (1 << d)) { ++n; pos = i; }
      if (n != 1) continue;
      Found f;
      f.place_cell = pos;
      f.place_digit = d;
      f.pattern = {pos};
      if (g_desc)
        f.desc = "Within " + region_name(g) + ", " + sym(d) +
                 " fits only in " + cell_name(pos) + ".";
      out.push_back(std::move(f));
    }
}

// -- 3: locked candidates (pointing + claiming) ---------------------------------
void scan_locked(const State& s, std::vector<Found>& out) {
  for (int b = 18; b < 27; ++b)
    for (int L = 0; L < 18; ++L) {
      CellSet inter = T.region_set[b] & T.region_set[L];
      if (inter.count() != 3) continue;
      for (int d = 1; d <= 9; ++d) {
        CellSet dc      = s.digit_cells(d);
        CellSet in_box  = dc & T.region_set[b];
        CellSet in_line = dc & T.region_set[L];
        auto emit = [&](CellSet pat, CellSet targets, int inside, int outside) {
          if (targets.empty()) return;
          Found f;
          pat.for_each([&](int c) { f.pattern.push_back(c); });
          targets.for_each([&](int c) { f.elims.push_back({c, Mask(1 << d)}); });
          if (g_desc)
            f.desc = "In " + region_name(inside) + ", " + sym(d) +
                     " is confined to " + region_name(outside) + " — remove " +
                     sym(d) + " from the rest of " + region_name(outside) + ".";
          out.push_back(std::move(f));
        };
        if (!in_box.empty() && in_box.subset_of(inter))            // pointing
          emit(in_box, in_line.minus(inter), b, L);
        if (!in_line.empty() && in_line.subset_of(inter))          // claiming
          emit(in_line, in_box.minus(inter), L, b);
      }
    }
}

// -- 4/6/8: naked pair / triple / quad ------------------------------------------
const char* SET_NAME[5] = {"", "", "pair", "triple", "quad"};

void scan_naked_set(const State& s, int K, std::vector<Found>& out) {
  for (int g = 0; g < 27; ++g) {
    std::array<int, 9> open{};
    int n = 0;
    for (int i : T.region[g]) if (!s.val[i]) open[n++] = i;
    std::array<int, 4> pick{};
    auto rec = [&](auto&& self, int start, int depth, Mask uni) -> void {
      if (popcount(uni) > K) return;
      if (depth == K) {
        if (popcount(uni) != K) return;
        Found f;
        for (int k = 0; k < K; ++k) f.pattern.push_back(pick[k]);
        for (int i : T.region[g]) {
          if (s.val[i]) continue;
          bool chosen = false;
          for (int k = 0; k < K; ++k) chosen |= (i == pick[k]);
          if (!chosen && (s.cand[i] & uni)) f.elims.push_back({i, Mask(s.cand[i] & uni)});
        }
        if (f.elims.empty()) return;
        if (g_desc)
          f.desc = "In " + region_name(g) + ", cells " + cells_list(f.pattern) +
                   " together hold only " + sym_set(uni) + " — remove those digits from the region's other cells.";
        out.push_back(std::move(f));
        return;
      }
      for (int a = start; a < n; ++a) {
        pick[depth] = open[a];
        self(self, a + 1, depth + 1, Mask(uni | s.cand[open[a]]));
      }
    };
    rec(rec, 0, 0, 0);
  }
}

// -- 5/7/9: hidden pair / triple / quad -----------------------------------------
void scan_hidden_set(const State& s, int K, std::vector<Found>& out) {
  for (int g = 0; g < 27; ++g) {
    std::array<uint16_t, 10> pos{};
    for (int d = 1; d <= 9; ++d)
      for (int k = 0; k < 9; ++k)
        if (s.cand[T.region[g][k]] & (1 << d)) pos[d] |= uint16_t(1 << k);
    std::array<int, 4> pick{};
    auto rec = [&](auto&& self, int start, int depth, unsigned uni) -> void {
      if (popcount(uni) > K) return;
      if (depth == K) {
        if (popcount(uni) != K) return;
        Mask keep = 0;
        for (int k = 0; k < K; ++k) keep |= Mask(1 << pick[k]);
        Found f;
        for (unsigned p = uni; p; p &= p - 1) {
          int cell = T.region[g][lowest_bit(p)];
          f.pattern.push_back(cell);
          if (s.cand[cell] & ~keep) f.elims.push_back({cell, Mask(s.cand[cell] & ~keep)});
        }
        if (f.elims.empty()) return;
        if (g_desc)
          f.desc = "Within " + region_name(g) + ", digits " + sym_set(keep) +
                   " fit only in " + cells_list(f.pattern) + " — those cells can hold nothing else.";
        out.push_back(std::move(f));
        return;
      }
      for (int d = start; d <= 9; ++d) {
        if (!pos[d]) continue;
        pick[depth] = d;
        self(self, d + 1, depth + 1, uni | pos[d]);
      }
    };
    rec(rec, 1, 0, 0);
  }
}

// -- 10/14/15: line fish (X-Wing, Swordfish, Jellyfish) --------------------------
// Standard fish: N base lines whose candidates for d (2..N per line) fit inside
// exactly N cover lines of the other orientation; remove d from the cover lines
// outside the base lines.
void scan_line_fish(const State& s, int N, std::vector<Found>& out) {
  const char* fish_name = N == 2 ? "X-Wing" : N == 3 ? "Swordfish" : "Jellyfish";
  for (int d = 1; d <= 9; ++d)
    for (int orient = 0; orient < 2; ++orient) {   // 0: rows base, 1: cols base
      uint16_t pos[9];
      for (int a = 0; a < 9; ++a) {
        pos[a] = 0;
        for (int b = 0; b < 9; ++b) {
          int cell = orient ? b * 9 + a : a * 9 + b;
          if (s.cand[cell] & (1 << d)) pos[a] |= uint16_t(1 << b);
        }
      }
      std::array<int, 4> base{};
      auto rec = [&](auto&& self, int start, int depth, unsigned uni) -> void {
        if (popcount(uni) > N) return;
        if (depth == N) {
          if (popcount(uni) != N) return;
          Found f;
          for (int k = 0; k < N; ++k)
            for (unsigned p = pos[base[k]]; p; p &= p - 1) {
              int b = lowest_bit(p);
              f.pattern.push_back(orient ? b * 9 + base[k] : base[k] * 9 + b);
            }
          for (int a = 0; a < 9; ++a) {
            bool is_base = false;
            for (int k = 0; k < N; ++k) is_base |= (a == base[k]);
            if (is_base) continue;
            for (unsigned p = pos[a] & uni; p; p &= p - 1) {
              int b = lowest_bit(p);
              f.elims.push_back({orient ? b * 9 + a : a * 9 + b, Mask(1 << d)});
            }
          }
          if (f.elims.empty()) return;
          if (g_desc) {
            auto line_list = [&](const int* ids, int n, bool cols) {
              std::string r;
              for (int k = 0; k < n; ++k) { if (k) r += ", "; r += std::to_string(ids[k] + 1); }
              return (cols ? std::string("columns ") : std::string("rows ")) + r;
            };
            int covers[4], nc = 0;
            for (unsigned p = uni; p; p &= p - 1) covers[nc++] = lowest_bit(p);
            f.desc = std::string(fish_name) + " on " + sym(d) + ": " +
                     line_list(base.data(), N, orient) + " hold " + sym(d) +
                     " only within " + line_list(covers, N, !orient) + " — remove " +
                     sym(d) + " from the rest of those lines.";
          }
          out.push_back(std::move(f));
          return;
        }
        for (int a = start; a < 9; ++a) {
          int n = popcount(pos[a]);
          if (n < 2 || n > N) continue;
          base[depth] = a;
          self(self, a + 1, depth + 1, uni | pos[a]);
        }
      };
      rec(rec, 0, 0, 0);
    }
}

// -- 11: skyscraper / 2-string kite (turbot fish) --------------------------------
// Two strong links A=B and C=D on digit d (regions where d has exactly two
// spots), whose inner ends B,C see each other.  Then not-A forces D, so A or D
// is true: remove d from every other cell that sees both A and D.
void scan_turbot(const State& s, std::vector<Found>& out) {
  for (int d = 1; d <= 9; ++d) {
    CellSet dc = s.digit_cells(d);
    struct Link { int a, b; };
    std::vector<Link> links;
    for (int g = 0; g < 27; ++g) {
      CellSet in = dc & T.region_set[g];
      if (in.count() != 2) continue;
      int cells[2], n = 0;
      in.for_each([&](int c) { cells[n++] = c; });
      links.push_back({cells[0], cells[1]});
    }
    for (size_t i = 0; i < links.size(); ++i)
      for (size_t j = i + 1; j < links.size(); ++j)
        for (int oi = 0; oi < 2; ++oi)
          for (int oj = 0; oj < 2; ++oj) {
            int A = oi ? links[i].b : links[i].a, B = oi ? links[i].a : links[i].b;
            int C = oj ? links[j].b : links[j].a, D = oj ? links[j].a : links[j].b;
            if (A == C || A == D || B == C || B == D) continue;
            if (!T.peer_set[B].test(C)) continue;               // weak link B~C
            CellSet targets = T.peer_set[A] & T.peer_set[D] & dc;
            for (int x : {A, B, C, D}) targets = targets.minus([&]{ CellSet o; o.set(x); return o; }());
            if (targets.empty()) continue;
            Found f;
            f.pattern = {A, B, C, D};
            targets.for_each([&](int c) { f.elims.push_back({c, Mask(1 << d)}); });
            if (g_desc)
              f.desc = "Skyscraper/kite on " + sym(d) + ": strong links " +
                       cell_name(A) + "=" + cell_name(B) + " and " + cell_name(C) + "=" +
                       cell_name(D) + " connect through " + cell_name(B) + "–" + cell_name(C) +
                       ", so " + cell_name(A) + " or " + cell_name(D) + " must be " +
                       sym(d) + " — remove " + sym(d) +
                       " from cells that see both.";
            out.push_back(std::move(f));
          }
  }
}

// -- 12: XY-Wing ------------------------------------------------------------------
// Pivot {X,Y} sees pincers {X,Z} and {Y,Z}: one pincer holds Z, so remove Z
// from cells seeing both pincers.
void scan_xy_wing(const State& s, std::vector<Found>& out) {
  std::vector<int> bival;
  for (int i = 0; i < 81; ++i)
    if (!s.val[i] && popcount(s.cand[i]) == 2) bival.push_back(i);
  for (int p : bival) {
    std::vector<int> wings;
    for (int q : bival)
      if (q != p && T.peer_set[p].test(q)) wings.push_back(q);
    for (size_t a = 0; a < wings.size(); ++a)
      for (size_t b = a + 1; b < wings.size(); ++b) {
        int q = wings[a], r = wings[b];
        Mask pm = s.cand[p], qm = s.cand[q], rm = s.cand[r];
        if (qm == pm || rm == pm || qm == rm) continue;
        if (popcount(unsigned(pm | qm | rm)) != 3) continue;
        Mask z = Mask(qm & rm & ~pm);
        if (popcount(z) != 1) continue;
        CellSet targets = T.peer_set[q] & T.peer_set[r] & s.digit_cells(lowest_bit(z));
        targets = targets.minus([&]{ CellSet o; o.set(p); o.set(q); o.set(r); return o; }());
        if (targets.empty()) continue;
        Found f;
        f.pattern = {p, q, r};
        targets.for_each([&](int c) { f.elims.push_back({c, z}); });
        if (g_desc)
          f.desc = "XY-Wing: pivot " + cell_name(p) + " " + sym_set(pm) +
                   " with pincers " + cell_name(q) + " " + sym_set(qm) + " and " +
                   cell_name(r) + " " + sym_set(rm) + " — one pincer must be " +
                   sym(lowest_bit(z)) + "; remove it from cells seeing both pincers.";
        out.push_back(std::move(f));
      }
  }
}

// -- 13: XYZ-Wing -------------------------------------------------------------------
// Pivot {X,Y,Z} sees pincers {X,Z} and {Y,Z}: Z is removed from cells seeing
// all three.
void scan_xyz_wing(const State& s, std::vector<Found>& out) {
  for (int p = 0; p < 81; ++p) {
    if (s.val[p] || popcount(s.cand[p]) != 3) continue;
    std::vector<int> wings;
    for (int q : T.peers[p])
      if (!s.val[q] && popcount(s.cand[q]) == 2 && !(s.cand[q] & ~s.cand[p]))
        wings.push_back(q);
    for (size_t a = 0; a < wings.size(); ++a)
      for (size_t b = a + 1; b < wings.size(); ++b) {
        int q = wings[a], r = wings[b];
        Mask qm = s.cand[q], rm = s.cand[r];
        if (qm == rm || Mask(qm | rm) != s.cand[p]) continue;
        Mask z = Mask(qm & rm);
        if (popcount(z) != 1) continue;
        CellSet targets = T.peer_set[p] & T.peer_set[q] & T.peer_set[r] &
                          s.digit_cells(lowest_bit(z));
        targets = targets.minus([&]{ CellSet o; o.set(p); o.set(q); o.set(r); return o; }());
        if (targets.empty()) continue;
        Found f;
        f.pattern = {p, q, r};
        targets.for_each([&](int c) { f.elims.push_back({c, z}); });
        if (g_desc)
          f.desc = "XYZ-Wing: pivot " + cell_name(p) + " " + sym_set(s.cand[p]) +
                   " with pincers " + cell_name(q) + " " + sym_set(qm) + " and " +
                   cell_name(r) + " " + sym_set(rm) + " — every case places " +
                   sym(lowest_bit(z)) + " among them; remove it from cells seeing all three.";
        out.push_back(std::move(f));
      }
  }
}

// --------------------------------------------------------- technique table --
void scan_naked_pair(const State& s, std::vector<Found>& o)   { scan_naked_set(s, 2, o); }
void scan_hidden_pair(const State& s, std::vector<Found>& o)  { scan_hidden_set(s, 2, o); }
void scan_naked_triple(const State& s, std::vector<Found>& o) { scan_naked_set(s, 3, o); }
void scan_hidden_triple(const State& s, std::vector<Found>& o){ scan_hidden_set(s, 3, o); }
void scan_naked_quad(const State& s, std::vector<Found>& o)   { scan_naked_set(s, 4, o); }
void scan_hidden_quad(const State& s, std::vector<Found>& o)  { scan_hidden_set(s, 4, o); }
void scan_xwing(const State& s, std::vector<Found>& o)        { scan_line_fish(s, 2, o); }
void scan_swordfish(const State& s, std::vector<Found>& o)    { scan_line_fish(s, 3, o); }
void scan_jellyfish(const State& s, std::vector<Found>& o)    { scan_line_fish(s, 4, o); }

struct Tech { const char* name; void (*scan)(const State&, std::vector<Found>&); };
constexpr int NUM_TECH = 15;
const std::array<Tech, NUM_TECH + 1> TECHS = {{
    {"", nullptr},
    {"Naked single",      scan_naked_single},   //  1
    {"Hidden single",     scan_hidden_single},  //  2
    {"Locked candidates", scan_locked},         //  3
    {"Naked pair",        scan_naked_pair},     //  4
    {"Hidden pair",       scan_hidden_pair},    //  5
    {"Naked triple",      scan_naked_triple},   //  6
    {"Hidden triple",     scan_hidden_triple},  //  7
    {"Naked quad",        scan_naked_quad},     //  8
    {"Hidden quad",       scan_hidden_quad},    //  9
    {"X-Wing",            scan_xwing},          // 10
    {"Skyscraper / kite", scan_turbot},         // 11
    {"XY-Wing",           scan_xy_wing},        // 12
    {"XYZ-Wing",          scan_xyz_wing},       // 13
    {"Swordfish",         scan_swordfish},      // 14
    {"Jellyfish",         scan_jellyfish},      // 15
}};

int run_tech(int t, State& s) {
  std::vector<Found> fs;
  TECHS[t].scan(s, fs);
  dedupe(fs);
  return apply_founds(s, fs);
}

// -------------------------------------------------------------- profiling --
Profile profile_puzzle(const std::array<int, 81>& givens) {
  State s;
  s.init(givens);
  Profile P;
  while (!s.solved() && !s.contradiction()) {
    int applied = 0, tier = 0;
    for (int t = 1; t <= NUM_TECH && !applied; ++t) {
      applied = run_tech(t, s);
      tier = t;
    }
    if (!applied) break;
    P.steps.push_back({tier, applied});
    P.total += applied;
    P.hardest = std::max(P.hardest, tier);
    if (P.steps.size() > 1000) break;
  }
  P.solved_logically = s.solved();
  return P;
}

// -------------------------------------------------------------- generator --
std::array<int, 81> generate_puzzle(int target_clues, std::mt19937& rng) {
  std::array<int, 81> puzzle{};
  fill_solved(puzzle, rng);
  std::array<int, 41> order{};
  for (int i = 0; i < 41; ++i) order[i] = i;
  std::shuffle(order.begin(), order.end(), rng);
  int clues = 81;
  for (int p : order) {
    if (clues <= target_clues) break;
    int  cells[2] = {p, 80 - p};
    int  n        = (p == 40) ? 1 : 2;
    int  saved[2] = {puzzle[cells[0]], puzzle[cells[1]]};
    bool ok = true;
    for (int k = 0; k < n; ++k)
      if (!puzzle[cells[k]]) ok = false;
    if (!ok) continue;
    for (int k = 0; k < n; ++k) puzzle[cells[k]] = 0;
    auto probe = puzzle;
    if (count_solutions(probe, 2) == 1) clues -= n;
    else
      for (int k = 0; k < n; ++k) puzzle[cells[k]] = saved[k];
  }
  return puzzle;
}

// Profile-targeted generation.  Rejection-samples raw puzzles until the
// difficulty profile lands in the level's hardest-tier window; falls back to
// the closest logic-solvable candidate if the window isn't hit in time.
struct LevelSpec { const char* name; int clues; int lo, hi; int max_attempts; };
const LevelSpec LEVELS[] = {
    {"Beginner", 44, 1, 1, 400},    // naked singles all the way down
    {"Easy",     37, 2, 2, 400},    // singles only
    {"Medium",   28, 3, 5, 500},    // locked candidates / pairs
    {"Hard",     27, 6, 11, 600},   // triples / quads / X-Wing / skyscraper
    {"Expert",   24, 12, 15, 900},  // wings and big fish
};

struct Generated {
  std::array<int, 81> puzzle{};
  Profile prof;
  int attempts = 0;
};

Generated generate_level_impl(int level, std::mt19937& rng) {
  const LevelSpec& L = LEVELS[level];
  Generated best;
  int best_score = 1 << 30;
  for (int att = 1; att <= L.max_attempts; ++att) {
    auto puzzle = generate_puzzle(L.clues, rng);
    Profile P   = profile_puzzle(puzzle);
    int h       = P.hardest;
    bool in_win = P.solved_logically && h >= L.lo && h <= L.hi;
    // Score: 0 if in window; otherwise distance to window (+ big penalty if
    // not logic-solvable, so a stuck puzzle is only ever a last resort).
    int score = in_win ? 0
              : (P.solved_logically ? (h < L.lo ? L.lo - h : h - L.hi)
                                    : 1000 + std::max(0, L.lo - h));
    if (score < best_score) {
      best_score = score;
      best = {puzzle, P, att};
      if (score == 0) break;
    }
  }
  best.attempts = std::min(best.attempts, L.max_attempts);
  return best;
}

// ------------------------------------------------------------------- JSON --
std::string board_string(const std::array<int, 81>& b) {
  std::string s(81, '0');
  for (int i = 0; i < 81; ++i) s[i] = char('0' + b[i]);
  return s;
}

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

void append_cells_json(std::string& out, const char* key, const std::vector<int>& cs) {
  out += '"';
  out += key;
  out += "\":[";
  for (size_t k = 0; k < cs.size(); ++k) {
    if (k) out += ',';
    out += std::to_string(cs[k]);
  }
  out += ']';
}

std::string g_result;

std::array<int, 81> parse_board(const char* b) {
  std::array<int, 81> v{};
  for (int i = 0; i < 81 && b[i]; ++i)
    v[i] = (b[i] >= '1' && b[i] <= '9') ? b[i] - '0' : 0;
  return v;
}

}  // namespace

// ========================== public evaluation API ===========================
/// Evaluate an arbitrary Sudoku instance and produce its difficulty profile.
///
/// This is the intended entry point for external puzzle-generation research:
/// hand it a candidate instance and it either returns the full solving
/// profile (see Profile) or tells you why the instance is unusable.
///
/// @param givens 81 values in row-major order; 0 = empty, 1..9 = clue.
/// @param search_cap node budget for the uniqueness search. The default is
///        ample for any 9x9 instance; lower it if you are screening millions
///        of candidates and prefer fast "unknown" over slow certainty.
/// @return the Profile computed by repeatedly applying the easiest applicable
///         technique tier (see TECHS for the ladder and its order), or:
///         - EvalError::NoSolution          the clues admit no completion
///         - EvalError::MultipleSolutions   at least two completions exist
///         - EvalError::SearchLimitExceeded search_cap hit before deciding
///
/// A returned Profile with solved_logically == false means the instance is
/// valid (unique) but requires search beyond the technique ladder; hardest
/// and steps still describe how far logic alone gets.
Expected<Profile, EvalError> evaluate_puzzle(const std::array<int, 81>& givens,
                                             long long search_cap = 5000000) {
  // The MRV counter constrains only empty cells, so contradictions *between
  // givens* must be checked explicitly.
  for (int i = 0; i < 81; ++i) {
    if (!givens[i]) continue;
    for (int p : T.peers[i])
      if (givens[p] == givens[i]) return Unexpected<EvalError>(EvalError::NoSolution);
  }
  auto probe = givens;
  g_solver_nodes = 0;
  g_solver_cap = search_cap;
  g_solver_capped = false;
  int n = count_solutions(probe, 2);
  if (g_solver_capped) return Unexpected<EvalError>(EvalError::SearchLimitExceeded);
  if (n == 0) return Unexpected<EvalError>(EvalError::NoSolution);
  if (n >= 2) return Unexpected<EvalError>(EvalError::MultipleSolutions);
  return profile_puzzle(givens);
}

// ---------------------------------------------------------------- exports --
extern "C" {

// JSON wrapper around evaluate_puzzle for the WASM/JS side.
// Returns {"status":"ok",...profile...} or {"status":"no_solution"} /
// {"status":"multiple_solutions"} / {"status":"search_limit_exceeded"}.
EXPORT const char* evaluate(const char* board81) {
  auto res = evaluate_puzzle(parse_board(board81));
  if (!res) {
    const char* what = res.error() == EvalError::NoSolution ? "no_solution"
                     : res.error() == EvalError::MultipleSolutions ? "multiple_solutions"
                     : "search_limit_exceeded";
    g_result = std::string("{\"status\":\"") + what + "\"}";
    return g_result.c_str();
  }
  g_result = "{\"status\":\"ok\",";
  append_profile_json(g_result, *res);
  g_result += '}';
  return g_result.c_str();
}

// Set display symbols for digits 1..9 as a comma-separated list (e.g.
// "A,B,C,D,E,F,G,H,I"). Affects hint descriptions only. Empty resets to 1-9.
EXPORT void set_symbols(const char* csv) {
  for (int d = 1; d <= 9; ++d) g_sym[d] = std::to_string(d);
  if (!csv || !*csv) return;
  int d = 1;
  std::string cur;
  for (const char* p = csv; d <= 9; ++p) {
    if (*p == ',' || *p == 0) {
      if (!cur.empty()) g_sym[d] = cur;
      ++d;
      cur.clear();
      if (*p == 0) break;
    } else cur += *p;
  }
}

EXPORT const char* generate(int target_clues, unsigned seed) {
  g_solver_nodes = 0; g_solver_cap = 1LL << 60; g_solver_capped = false;
  std::mt19937 rng(seed);
  auto puzzle = generate_puzzle(target_clues, rng);
  auto solved = puzzle;
  std::mt19937 r2(seed ^ 0x9E3779B9u);
  fill_solved(solved, r2);
  Profile P = profile_puzzle(puzzle);
  g_result = "{\"givens\":\"" + board_string(puzzle) + "\",\"solution\":\"" +
             board_string(solved) + "\",";
  append_profile_json(g_result, P);
  g_result += '}';
  return g_result.c_str();
}

EXPORT const char* generate_level(int level, unsigned seed) {
  g_solver_nodes = 0; g_solver_cap = 1LL << 60; g_solver_capped = false;
  level = std::max(0, std::min(4, level));
  std::mt19937 rng(seed);
  Generated G = generate_level_impl(level, rng);
  auto solved = G.puzzle;
  std::mt19937 r2(seed ^ 0x9E3779B9u);
  fill_solved(solved, r2);
  g_result = "{\"givens\":\"" + board_string(G.puzzle) + "\",\"solution\":\"" +
             board_string(solved) + "\",\"level\":\"" + LEVELS[level].name +
             "\",\"attempts\":" + std::to_string(G.attempts) + ",";
  append_profile_json(g_result, G.prof);
  g_result += '}';
  return g_result.c_str();
}

EXPORT const char* profile_board(const char* board81) {
  Profile P = profile_puzzle(parse_board(board81));
  g_result = "{";
  append_profile_json(g_result, P);
  g_result += '}';
  return g_result.c_str();
}

// hint(givens, current values, comma-separated per-cell elimination masks):
// verifies the position first (wrong entries / notes that struck the true
// digit are reported instead of a technique), then returns the easiest
// applicable technique with pattern cells, targets, and a human explanation.
EXPORT const char* hint(const char* givens81, const char* values81, const char* elim_csv) {
  auto givens = parse_board(givens81);
  auto values = parse_board(values81);
  std::array<Mask, 81> user_elim{};
  {
    int i = 0;
    for (const char* p = elim_csv; *p && i < 81; ++i) {
      int v = 0;
      while (*p >= '0' && *p <= '9') v = v * 10 + (*p++ - '0');
      if (*p == ',') ++p;
      user_elim[i] = Mask(v) & ALL;
    }
  }
  auto solution = givens;
  std::mt19937 rng(1);
  if (!fill_solved(solution, rng)) { g_result = "{\"error\":\"invalid\"}"; return g_result.c_str(); }

  std::vector<int> bad;
  for (int i = 0; i < 81; ++i)
    if (!givens[i] && values[i] && values[i] != solution[i]) bad.push_back(i);
  if (!bad.empty()) {
    g_result = "{\"error\":\"mistakes\",";
    append_cells_json(g_result, "cells", bad);
    g_result += '}';
    return g_result.c_str();
  }
  for (int i = 0; i < 81; ++i)
    if (!values[i] && (user_elim[i] & (1 << solution[i]))) bad.push_back(i);
  if (!bad.empty()) {
    g_result = "{\"error\":\"badnotes\",";
    append_cells_json(g_result, "cells", bad);
    g_result += '}';
    return g_result.c_str();
  }

  State s;
  s.init(values);
  if (s.solved()) { g_result = "{\"error\":\"solved\"}"; return g_result.c_str(); }
  for (int i = 0; i < 81; ++i) s.cand[i] &= ~user_elim[i];   // honor the notes

  g_desc = true;
  for (int t = 1; t <= NUM_TECH; ++t) {
    std::vector<Found> fs;
    TECHS[t].scan(s, fs);
    dedupe(fs);
    if (fs.empty()) continue;
    const Found& f = fs.front();
    g_desc = false;
    std::vector<int> targets;
    for (const auto& e : f.elims) targets.push_back(e.cell);
    g_result = "{\"tier\":" + std::to_string(t) + ",\"name\":\"" + TECHS[t].name +
               "\",\"desc\":\"" + f.desc + "\",";
    append_cells_json(g_result, "pattern", f.pattern);
    g_result += ',';
    append_cells_json(g_result, "targets", targets);
    if (f.place_cell >= 0)
      g_result += ",\"place\":" + std::to_string(f.place_cell) +
                  ",\"placeDigit\":" + std::to_string(f.place_digit);
    g_result += '}';
    return g_result.c_str();
  }
  g_desc = false;
  g_result = "{\"error\":\"stuck\"}";
  return g_result.c_str();
}

}  // extern "C"

// ------------------------------------------------------------ native test --
#ifdef NATIVE_TEST
#include <chrono>
#include <cstdio>
#include <map>
int main() {
  // 1. Technique soundness fuzz: every tier, random states with known solutions.
  {
    std::mt19937 rng(12345);
    long fired[NUM_TECH + 1] = {};
    for (int iter = 0; iter < 20000; ++iter) {
      std::array<int, 81> sol{};
      fill_solved(sol, rng);
      std::array<int, 81> puz = sol;
      std::array<int, 81> idx{};
      for (int i = 0; i < 81; ++i) idx[i] = i;
      std::shuffle(idx.begin(), idx.end(), rng);
      int keep = 20 + int(rng() % 40);
      for (int k = keep; k < 81; ++k) puz[idx[k]] = 0;
      for (int tier = 1; tier <= NUM_TECH; ++tier) {
        State s;
        s.init(puz);
        for (int i = 0; i < 81; ++i)                 // random true-preserving strikes
          if (!s.val[i])
            for (int d = 1; d <= 9; ++d)
              if (d != sol[i] && (s.cand[i] & (1 << d)) && rng() % 4 == 0)
                s.cand[i] &= ~Mask(1 << d);
        fired[tier] += run_tech(tier, s);
        for (int i = 0; i < 81; ++i) {
          if (s.val[i] && s.val[i] != sol[i]) { std::printf("tier %d WRONG PLACEMENT\n", tier); return 1; }
          if (!s.val[i] && !(s.cand[i] & (1 << sol[i]))) { std::printf("tier %d UNSOUND ELIM\n", tier); return 1; }
        }
      }
    }
    for (int t = 1; t <= NUM_TECH; ++t)
      std::printf("tier %2d %-18s: %ld sound applications\n", t, TECHS[t].name, fired[t]);
  }
  // 2. Level generation: acceptance rate, timing, uniqueness, ladder soundness.
  for (int level = 0; level < 5; ++level) {
    int hit = 0;
    long ms_total = 0, att_total = 0;
    for (unsigned seed = 1; seed <= 30; ++seed) {
      auto t0 = std::chrono::steady_clock::now();
      std::mt19937 rng(seed * 2654435761u + level);
      Generated G = generate_level_impl(level, rng);
      ms_total += std::chrono::duration_cast<std::chrono::milliseconds>(
                      std::chrono::steady_clock::now() - t0).count();
      att_total += G.attempts;
      auto probe = G.puzzle;
      if (count_solutions(probe, 2) != 1) { std::printf("NON-UNIQUE\n"); return 1; }
      const LevelSpec& L = LEVELS[level];
      if (G.prof.solved_logically && G.prof.hardest >= L.lo && G.prof.hardest <= L.hi) ++hit;
      // stepwise soundness against the true solution
      auto sol = G.puzzle;
      std::mt19937 r2(seed);
      fill_solved(sol, r2);
      State s;
      s.init(G.puzzle);
      while (!s.solved()) {
        int a = 0;
        for (int t = 1; t <= NUM_TECH && !a; ++t) a = run_tech(t, s);
        if (!a) break;
        for (int i = 0; i < 81; ++i) {
          if (s.val[i] && s.val[i] != sol[i]) { std::printf("WRONG PLACEMENT L%d\n", level); return 1; }
          if (!s.val[i] && !(s.cand[i] & (1 << sol[i]))) { std::printf("UNSOUND ELIM L%d\n", level); return 1; }
        }
      }
    }
    std::printf("%-8s: window hit %2d/30, avg attempts %4ld, avg %4ld ms\n",
                LEVELS[level].name, hit, att_total / 30, ms_total / 30);
  }
  return 0;
}
#endif
