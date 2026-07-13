// kakuro.cpp — Kakuro generation, logical difficulty profiling, and hints.
//
// Build (WebAssembly):
//   emcc -O2 -std=c++2b kakuro.cpp -o kakuro_wasm.js \
//        -sMODULARIZE=1 -sEXPORT_NAME=createKakuroModule -sSINGLE_FILE=1 \
//        -sEXPORTED_FUNCTIONS=_generate_kakuro,_kakuro_hint \
//        -sEXPORTED_RUNTIME_METHODS=ccall,cwrap -sENVIRONMENT=web,node -sFILESYSTEM=0
//
// Build (native test):
//   g++ -O2 -std=c++23 -DNATIVE_TEST kakuro.cpp -o kakuro_test && ./kakuro_test
//
// Technique ladder (single table TECHS[]; reorder there):
//   1 Last cell            2 Forced single       3 Sum bounds
//   4 Unique combination   5 Combination filter  6 Required digit
//   7 Naked pair           8 Naked triple        9 Full run analysis
//
// Digits already used in a run are struck from its other cells automatically
// on placement (the same convention as sudoku peer elimination — humans do it
// instantly, so it is not a counted technique).

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
  InvalidInstance,       // malformed layout (see evaluate_puzzle docs)
  NoSolution,            // the runs admit no digit assignment
  MultipleSolutions,     // more than one assignment exists
  SearchLimitExceeded,   // solver hit its node budget before deciding
};

// ----------------------------- board geometry -------------------------------
// ------------------------------------------------------------------ layout --
// Board dimensions are runtime-configurable (row 0 / col 0 are the clue rim);
// storage is sized for the maximum.
constexpr int MAXW = 20, MAXN = MAXW * MAXW;
int W = 10, H = 10, N = 100;
void set_board_size(int playable) {
  playable = std::max(5, std::min(MAXW - 1, playable));
  W = H = playable + 1;
  N = W * H;
}

struct Run { std::vector<int> cells; int sum = 0; bool horiz = true; };

struct Layout {
  std::array<uint8_t, MAXN> black{};
  std::array<int, MAXN> hrun{}, vrun{};          // run id or -1
  std::vector<Run> runs;
};

bool build_runs(Layout& L) {
  L.runs.clear();
  L.hrun.fill(-1);
  L.vrun.fill(-1);
  for (int r = 1; r < H; ++r)
    for (int c = 1; c < W;) {
      if (L.black[r * W + c]) { ++c; continue; }
      int c0 = c;
      while (c < W && !L.black[r * W + c]) ++c;
      if (c - c0 < 2) return false;
      Run R;
      R.horiz = true;
      for (int x = c0; x < c; ++x) { L.hrun[r * W + x] = int(L.runs.size()); R.cells.push_back(r * W + x); }
      L.runs.push_back(std::move(R));
    }
  for (int c = 1; c < W; ++c)
    for (int r = 1; r < H;) {
      if (L.black[r * W + c]) { ++r; continue; }
      int r0 = r;
      while (r < H && !L.black[r * W + c]) ++r;
      if (r - r0 < 2) return false;
      Run R;
      R.horiz = false;
      for (int y = r0; y < r; ++y) { L.vrun[y * W + c] = int(L.runs.size()); R.cells.push_back(y * W + c); }
      L.runs.push_back(std::move(R));
    }
  return true;
}


namespace {

using Mask = uint16_t;                        // bits 1..9
constexpr Mask ALL = 0b1111111110;
inline int popcount(unsigned m)   { return __builtin_popcount(m); }
inline int lowest_bit(unsigned m) { return __builtin_ctz(m); }

int mask_sum(Mask m) {
  int s = 0;
  for (int d = 1; d <= 9; ++d)
    if (m & (1 << d)) s += d;
  return s;
}

// COMBOS[k][s]: all sets of k distinct digits 1..9 summing to s.
struct Combos {
  std::array<std::array<std::vector<Mask>, 46>, 10> c;
  Combos() {
    for (unsigned m = 1; m < 512; ++m) {
      Mask mask = Mask(m << 1);
      c[popcount(mask)][mask_sum(mask)].push_back(mask);
    }
  }
};
const Combos CB;

std::string cell_name(int i) { return "r" + std::to_string(i / W) + "c" + std::to_string(i % W); }
std::string digit_set(Mask m) {
  std::string s = "{";
  for (int d = 1; d <= 9; ++d)
    if (m & (1 << d)) { if (s.size() > 1) s += ","; s += std::to_string(d); }
  return s + "}";
}

bool gen_layout(Layout& L, int black_target, std::mt19937& rng) {
  L.black.fill(0);
  for (int r = 0; r < H; ++r) L.black[r * W] = 1;
  for (int c = 0; c < W; ++c) L.black[c] = 1;
  std::vector<int> pos;
  for (int r = 1; r < H; ++r)
    for (int c = 1; c < W; ++c) pos.push_back(r * W + c);
  std::shuffle(pos.begin(), pos.end(), rng);
  int placed = 0;
  for (int p : pos) {
    if (placed >= black_target) break;
    int r = p / W, c = p % W, q = (H - r) * W + (W - c);
    if (L.black[p] || L.black[q]) continue;
    L.black[p] = 1;
    L.black[q] = 1;
    placed += (p == q) ? 1 : 2;
  }
  for (int iter = 0; iter < 200; ++iter) {      // no length-1 runs allowed
    bool changed = false;
    for (int r = 1; r < H; ++r)
      for (int c = 1; c < W; ++c) {
        int i = r * W + c;
        if (L.black[i]) continue;
        bool lB = L.black[i - 1], rB = (c == W - 1) || L.black[i + 1];
        bool uB = L.black[i - W], dB = (r == H - 1) || L.black[i + W];
        if ((lB && rB) || (uB && dB)) {
          L.black[i] = 1;
          L.black[(H - r) * W + (W - c)] = 1;
          changed = true;
        }
      }
    if (!changed) break;
  }
  int whites = 0, first = -1;
  for (int i = 0; i < N; ++i)
    if (!L.black[i]) { ++whites; if (first < 0) first = i; }
  if (whites < (W - 1) * (H - 1) / 4) return false;
  std::vector<uint8_t> seen(N, 0);              // connectivity
  std::vector<int> stack{first};
  seen[first] = 1;
  int reached = 0;
  while (!stack.empty()) {
    int i = stack.back();
    stack.pop_back();
    ++reached;
    const int d[4] = {1, -1, W, -W};
    for (int k = 0; k < 4; ++k) {
      int j = i + d[k];
      if (j < 0 || j >= N) continue;
      if ((d[k] == 1 && j % W == 0) || (d[k] == -1 && i % W == 0)) continue;
      if (!L.black[j] && !seen[j]) { seen[j] = 1; stack.push_back(j); }
    }
  }
  if (reached != whites) return false;
  return build_runs(L);
}

// -------------------------------------------------------------------- fill --
struct RunState { Mask used = 0; int placed = 0; int empty = 0; };

bool fill(const Layout& L, std::array<int, MAXN>& val, std::mt19937& rng) {
  val.fill(0);
  std::vector<RunState> rs(L.runs.size());
  for (size_t j = 0; j < L.runs.size(); ++j) rs[j].empty = int(L.runs[j].cells.size());
  long nodes = 0;
  auto rec = [&](auto&& self) -> bool {
    if (++nodes > 200000) return false;
    int best = -1, bc = 10;
    Mask bm = 0;
    for (int i = 0; i < N; ++i) {
      if (L.black[i] || val[i]) continue;
      Mask m = ALL & ~rs[L.hrun[i]].used & ~rs[L.vrun[i]].used;
      int pc = popcount(m);
      if (!pc) return false;
      if (pc < bc) { best = i; bm = m; bc = pc; }
    }
    if (best < 0) return true;
    std::array<int, 9> ds{};
    int nd = 0;
    for (Mask m = bm; m; m &= m - 1) ds[nd++] = lowest_bit(m);
    std::shuffle(ds.begin(), ds.begin() + nd, rng);
    int h = L.hrun[best], v = L.vrun[best];
    for (int k = 0; k < nd; ++k) {
      int d = ds[k];
      val[best] = d;
      rs[h].used |= Mask(1 << d);
      rs[v].used |= Mask(1 << d);
      if (self(self)) return true;
      rs[h].used &= ~Mask(1 << d);
      rs[v].used &= ~Mask(1 << d);
      val[best] = 0;
    }
    return false;
  };
  return rec(rec);
}

// ------------------------------------------------------ uniqueness counting --
Mask feasible_or(int k, int S, Mask used) {
  if (k < 0 || S < 0 || S > 45) return 0;
  Mask acc = 0;
  for (Mask m : CB.c[k][S])
    if (!(m & used)) acc |= m;
  return acc;
}

int count_sol(const Layout& L, int limit, long& nodes, long cap, bool& capped,
              std::vector<std::array<int, MAXN>>* witnesses = nullptr) {
  std::array<int, MAXN> val{};
  std::vector<RunState> rs(L.runs.size());
  for (size_t j = 0; j < L.runs.size(); ++j) rs[j].empty = int(L.runs[j].cells.size());
  std::vector<Mask> allowed(L.runs.size());
  auto rec = [&](auto&& self, int lim) -> int {
    if (++nodes > cap) { capped = true; return lim; }
    for (size_t j = 0; j < L.runs.size(); ++j)
      allowed[j] = rs[j].empty
                       ? feasible_or(rs[j].empty, L.runs[j].sum - rs[j].placed, rs[j].used)
                       : 0;
    int best = -1, bc = 10;
    Mask bm = 0;
    bool any_empty = false;
    for (int i = 0; i < N; ++i) {
      if (L.black[i] || val[i]) continue;
      any_empty = true;
      Mask m = allowed[L.hrun[i]] & allowed[L.vrun[i]];
      int pc = popcount(m);
      if (!pc) return 0;
      if (pc < bc) { best = i; bm = m; bc = pc; }
    }
    if (!any_empty) {
      if (witnesses && witnesses->size() < 2) witnesses->push_back(val);
      return 1;                                  // sums forced correct by construction
    }
    int h = L.hrun[best], v = L.vrun[best], total = 0;
    for (Mask m = bm; m; m &= m - 1) {
      int d = lowest_bit(m);
      val[best] = d;
      rs[h].used |= Mask(1 << d); rs[h].placed += d; --rs[h].empty;
      rs[v].used |= Mask(1 << d); rs[v].placed += d; --rs[v].empty;
      total += self(self, lim - total);
      rs[h].used &= ~Mask(1 << d); rs[h].placed -= d; ++rs[h].empty;
      rs[v].used &= ~Mask(1 << d); rs[v].placed -= d; ++rs[v].empty;
      val[best] = 0;
      if (total >= lim) break;
    }
    return total;
  };
  return rec(rec, limit);
}

// ------------------------------------------------------------ solving state --
struct KS {
  const Layout* L = nullptr;
  std::array<int, MAXN>  val{};
  std::array<Mask, MAXN> cand{};
  std::vector<RunState> rs;

  void init(const Layout& l) {
    L = &l;
    val.fill(0);
    rs.assign(L->runs.size(), {});
    for (size_t j = 0; j < L->runs.size(); ++j) rs[j].empty = int(L->runs[j].cells.size());
    for (int i = 0; i < N; ++i) cand[i] = L->black[i] ? 0 : ALL;
  }
  void place(int i, int d) {
    val[i] = d;
    cand[i] = 0;
    for (int j : {L->hrun[i], L->vrun[i]}) {
      rs[j].used |= Mask(1 << d);
      rs[j].placed += d;
      --rs[j].empty;
      for (int c : L->runs[j].cells)
        if (!val[c]) cand[c] &= ~Mask(1 << d);
    }
  }
  bool solved() const {
    for (int i = 0; i < N; ++i)
      if (!L->black[i] && !val[i]) return false;
    return true;
  }
  bool contradiction() const {
    for (int i = 0; i < N; ++i)
      if (!L->black[i] && !val[i] && !cand[i]) return true;
    return false;
  }
};

std::string run_name(const Layout& L, int j) {
  const Run& R = L.runs[j];
  return std::to_string(R.cells.size()) + "-cell " + (R.horiz ? "across" : "down") +
         " run at " + cell_name(R.cells[0]) + " (sum " + std::to_string(R.sum) + ")";
}

// -------------------------------------------------------------- techniques --
bool g_desc = false;

struct Elim { int cell; Mask digits; };
struct Found {
  std::vector<int>  pattern;
  std::vector<Elim> elims;
  int place_cell = -1, place_digit = 0;
  std::string desc;
};

void dedupe(std::vector<Found>& fs) {
  std::vector<Found> out;
  std::vector<std::vector<Elim>> seen;
  bool seen_place[MAXN] = {};
  auto less = [](const Elim& a, const Elim& b) {
    return a.cell != b.cell ? a.cell < b.cell : a.digits < b.digits;
  };
  for (auto& f : fs) {
    if (f.place_cell >= 0) {
      if (seen_place[f.place_cell]) continue;
      seen_place[f.place_cell] = true;
    } else {
      std::sort(f.elims.begin(), f.elims.end(), less);
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

int apply_founds(KS& s, const std::vector<Found>& fs) {
  for (const auto& f : fs) {
    if (f.place_cell >= 0) {
      if (!s.val[f.place_cell]) s.place(f.place_cell, f.place_digit);
    } else {
      for (const auto& e : f.elims) s.cand[e.cell] &= ~e.digits;
    }
  }
  return int(fs.size());
}

void feasible_list(const KS& s, int j, std::vector<Mask>& out) {
  const RunState& r = s.rs[j];
  int k = r.empty, S = s.L->runs[j].sum - r.placed;
  out.clear();
  if (k <= 0 || S < 0 || S > 45) return;
  for (Mask m : CB.c[k][S])
    if (!(m & r.used)) out.push_back(m);
}

// -- 1: last cell -------------------------------------------------------------
void scan_last(const KS& s, std::vector<Found>& out) {
  for (size_t j = 0; j < s.L->runs.size(); ++j) {
    if (s.rs[j].empty != 1) continue;
    int cell = -1;
    for (int c : s.L->runs[j].cells)
      if (!s.val[c]) cell = c;
    int d = s.L->runs[j].sum - s.rs[j].placed;
    if (d < 1 || d > 9 || (s.rs[j].used & (1 << d))) continue;
    Found f;
    f.place_cell = cell;
    f.place_digit = d;
    f.pattern = s.L->runs[j].cells;
    if (g_desc)
      f.desc = cell_name(cell) + " is the last empty cell of the " + run_name(*s.L, int(j)) +
               ", which still needs " + std::to_string(d) + ".";
    out.push_back(std::move(f));
  }
}

// -- 2: forced single ----------------------------------------------------------
void scan_single(const KS& s, std::vector<Found>& out) {
  for (int i = 0; i < N; ++i) {
    if (s.L->black[i] || s.val[i] || popcount(s.cand[i]) != 1) continue;
    Found f;
    f.place_cell = i;
    f.place_digit = lowest_bit(s.cand[i]);
    f.pattern = {i};
    if (g_desc)
      f.desc = cell_name(i) + " has only one candidate left: " +
               std::to_string(f.place_digit) + ".";
    out.push_back(std::move(f));
  }
}

// -- 3: sum bounds --------------------------------------------------------------
void scan_bounds(const KS& s, std::vector<Found>& out) {
  for (size_t j = 0; j < s.L->runs.size(); ++j) {
    const RunState& r = s.rs[j];
    int k = r.empty, S = s.L->runs[j].sum - r.placed;
    if (k < 2) continue;
    Mask pool = ALL & ~r.used;
    Found f;
    for (int c : s.L->runs[j].cells) {
      if (s.val[c]) continue;
      Mask bad = 0;
      for (Mask m = s.cand[c]; m; m &= m - 1) {
        int d = lowest_bit(m);
        Mask others = pool & ~Mask(1 << d);
        int lo = 0, hi = 0, cnt = 0;
        for (int x = 1; x <= 9 && cnt < k - 1; ++x)
          if (others & (1 << x)) { lo += x; ++cnt; }
        if (cnt < k - 1) { bad |= Mask(1 << d); continue; }
        cnt = 0;
        for (int x = 9; x >= 1 && cnt < k - 1; --x)
          if (others & (1 << x)) { hi += x; ++cnt; }
        if (S - d < lo || S - d > hi) bad |= Mask(1 << d);
      }
      if (bad) f.elims.push_back({c, bad});
    }
    if (f.elims.empty()) continue;
    f.pattern = s.L->runs[j].cells;
    if (g_desc)
      f.desc = "In the " + run_name(*s.L, int(j)) + ", the struck digits are too large or too " +
               "small for the remaining sum of " + std::to_string(S) + " over " +
               std::to_string(k) + " cells.";
    out.push_back(std::move(f));
  }
}

// -- 4/5: unique combination & combination filter --------------------------------
void scan_combo(const KS& s, bool unique_only, std::vector<Found>& out) {
  std::vector<Mask> fs;
  for (size_t j = 0; j < s.L->runs.size(); ++j) {
    if (s.rs[j].empty < 2) continue;
    feasible_list(s, j, fs);
    if (fs.empty()) continue;
    if (unique_only && fs.size() != 1) continue;
    Mask allowed = 0;
    for (Mask m : fs) allowed |= m;
    Found f;
    for (int c : s.L->runs[j].cells)
      if (!s.val[c] && (s.cand[c] & ~allowed)) f.elims.push_back({c, Mask(s.cand[c] & ~allowed)});
    if (f.elims.empty()) continue;
    f.pattern = s.L->runs[j].cells;
    if (g_desc) {
      int k = s.rs[j].empty, S = s.L->runs[j].sum - s.rs[j].placed;
      f.desc = unique_only
                   ? "The " + run_name(*s.L, int(j)) + " has a single way to make " +
                         std::to_string(S) + " with " + std::to_string(k) + " cells: " +
                         digit_set(allowed) + "."
                   : "No valid combination for the " + run_name(*s.L, int(j)) +
                         " (remaining sum " + std::to_string(S) + ") uses the struck digits.";
    }
    out.push_back(std::move(f));
  }
}
void scan_unique_combo(const KS& s, std::vector<Found>& o) { scan_combo(s, true, o); }
void scan_combo_filter(const KS& s, std::vector<Found>& o) { scan_combo(s, false, o); }

// -- 6: required digit ------------------------------------------------------------
void scan_required(const KS& s, std::vector<Found>& out) {
  std::vector<Mask> fs;
  for (size_t j = 0; j < s.L->runs.size(); ++j) {
    if (s.rs[j].empty < 2) continue;
    feasible_list(s, j, fs);
    if (fs.empty()) continue;
    Mask req = ALL;
    for (Mask m : fs) req &= m;
    for (Mask m = req; m; m &= m - 1) {
      int d = lowest_bit(m), cnt = 0, pos = -1;
      for (int c : s.L->runs[j].cells)
        if (!s.val[c] && (s.cand[c] & (1 << d))) { ++cnt; pos = c; }
      if (cnt != 1) continue;
      Found f;
      f.place_cell = pos;
      f.place_digit = d;
      f.pattern = s.L->runs[j].cells;
      if (g_desc)
        f.desc = "Every combination for the " + run_name(*s.L, int(j)) + " contains " +
                 std::to_string(d) + ", and only " + cell_name(pos) + " can take it.";
      out.push_back(std::move(f));
    }
  }
}

// -- 7/8: naked pair / triple within a run -------------------------------------------
void scan_naked_set(const KS& s, int K, std::vector<Found>& out) {
  for (size_t j = 0; j < s.L->runs.size(); ++j) {
    const auto& cells = s.L->runs[j].cells;
    std::vector<int> open;
    for (int c : cells)
      if (!s.val[c]) open.push_back(c);
    if (int(open.size()) <= K) continue;
    std::array<int, 3> pick{};
    auto rec = [&](auto&& self, int start, int depth, Mask uni) -> void {
      if (popcount(uni) > K) return;
      if (depth == K) {
        if (popcount(uni) != K) return;
        Found f;
        for (int k = 0; k < K; ++k) f.pattern.push_back(pick[k]);
        for (int c : open) {
          bool chosen = false;
          for (int k = 0; k < K; ++k) chosen |= (c == pick[k]);
          if (!chosen && (s.cand[c] & uni)) f.elims.push_back({c, Mask(s.cand[c] & uni)});
        }
        if (f.elims.empty()) return;
        if (g_desc)
          f.desc = "In the " + run_name(*s.L, int(j)) + ", " + std::to_string(K) +
                   " cells hold only " + digit_set(uni) +
                   " — those digits can't appear elsewhere in the run.";
        out.push_back(std::move(f));
        return;
      }
      for (size_t a = start; a < open.size(); ++a) {
        pick[depth] = open[a];
        self(self, int(a) + 1, depth + 1, Mask(uni | s.cand[open[a]]));
      }
    };
    rec(rec, 0, 0, 0);
  }
}
void scan_naked_pair(const KS& s, std::vector<Found>& o)   { scan_naked_set(s, 2, o); }
void scan_naked_triple(const KS& s, std::vector<Found>& o) { scan_naked_set(s, 3, o); }

// -- 9: full run analysis -----------------------------------------------------------
// Enumerate every assignment of a run consistent with the current candidates
// (distinct digits, exact remaining sum); strike candidates in no assignment.
void scan_run_analysis(const KS& s, std::vector<Found>& out) {
  for (size_t j = 0; j < s.L->runs.size(); ++j) {
    const RunState& r = s.rs[j];
    int k = r.empty, S = s.L->runs[j].sum - r.placed;
    if (k < 2) continue;
    std::vector<int> open;
    for (int c : s.L->runs[j].cells)
      if (!s.val[c]) open.push_back(c);
    std::sort(open.begin(), open.end(),
              [&](int a, int b) { return popcount(s.cand[a]) < popcount(s.cand[b]); });
    std::vector<Mask> seen(open.size(), 0);
    long nodes = 0;
    bool capped = false;
    std::vector<int> path;
    auto clean = [&](auto&& self, int idx, Mask used, int rem) -> bool {
      if (capped || ++nodes > 40000) { capped = true; return false; }
      if (idx == int(open.size())) {
        if (rem != 0) return false;
        for (int t = 0; t < idx; ++t) seen[t] |= Mask(1 << path[t]);
        return true;
      }
      bool any = false;
      int left = int(open.size()) - idx;
      for (Mask m = Mask(s.cand[open[idx]] & ~used & ~r.used); m; m &= m - 1) {
        int d = lowest_bit(m);
        if (d > rem) break;
        Mask pool = ALL & ~used & ~r.used & ~Mask(1 << d);
        int lo = 0, hi = 0, cnt = 0;
        for (int x = 1; x <= 9 && cnt < left - 1; ++x)
          if (pool & (1 << x)) { lo += x; ++cnt; }
        if (cnt < left - 1) continue;
        cnt = 0;
        for (int x = 9; x >= 1 && cnt < left - 1; --x)
          if (pool & (1 << x)) { hi += x; ++cnt; }
        if (rem - d < lo || rem - d > hi) continue;
        path.push_back(d);
        if (self(self, idx + 1, Mask(used | (1 << d)), rem - d)) any = true;
        path.pop_back();
      }
      return any;
    };
    clean(clean, 0, 0, S);
    if (capped) continue;
    Found f;
    for (size_t t = 0; t < open.size(); ++t) {
      Mask bad = Mask(s.cand[open[t]] & ~seen[t]);
      if (bad && seen[t]) f.elims.push_back({open[t], bad});
    }
    if (f.elims.empty()) continue;
    f.pattern = s.L->runs[j].cells;
    if (g_desc)
      f.desc = "Working through every possible arrangement of the " + run_name(*s.L, int(j)) +
               " shows the struck digits appear in none of them.";
    out.push_back(std::move(f));
  }
}

// ------------------------------------------------------------ technique table --
struct Tech { const char* name; void (*scan)(const KS&, std::vector<Found>&); };
constexpr int NUM_TECH = 9;
const std::array<Tech, NUM_TECH + 1> TECHS = {{
    {"", nullptr},
    {"Last cell",          scan_last},          // 1
    {"Forced single",      scan_single},        // 2
    {"Sum bounds",         scan_bounds},        // 3
    {"Unique combination", scan_unique_combo},  // 4
    {"Combination filter", scan_combo_filter},  // 5
    {"Required digit",     scan_required},      // 6
    {"Naked pair",         scan_naked_pair},    // 7
    {"Naked triple",       scan_naked_triple},  // 8
    {"Run analysis",       scan_run_analysis},  // 9
}};

int run_tech(int t, KS& s) {
  std::vector<Found> fs;
  TECHS[t].scan(s, fs);
  dedupe(fs);
  return apply_founds(s, fs);
}

Profile profile_puzzle(const Layout& L) {
  KS s;
  s.init(L);
  Profile P;
  while (!s.solved() && !s.contradiction()) {
    int applied = 0, tier = 0;
    for (int t = 1; t <= NUM_TECH && !applied; ++t) { applied = run_tech(t, s); tier = t; }
    if (!applied) break;
    P.steps.push_back({tier, applied});
    P.total += applied;
    P.hardest = std::max(P.hardest, tier);
    if (P.steps.size() > 1000) break;
  }
  P.solved_logically = s.solved();
  return P;
}

// -------------------------------------------------------------- generation --
// Levels select on the hardest tier and, at the top tier, on how many
// run-analysis steps the profile contains (hardest + volume, per the
// difficulty-profile design).
struct LevelSpec {
  const char* name;
  int blacks_pct;      // initial black cells as % of the playable area
  int lo, hi;          // window on hardest tier
  int t9lo, t9hi;      // window on total tier-9 applications, calibrated for
                       //   a 9x9 playable area and scaled by area at runtime
  int max_attempts;
};
LevelSpec LEVELS[] = {
    {"Easy",   25, 1, 4, 0, 0,   30},
    {"Medium", 17, 5, 6, 0, 0,   30},
    {"Hard",   12, 9, 9, 1, 8,   30},
    {"Expert", 10, 9, 9, 9, 999, 30},
};
int scale_t9(int per81) {
  if (per81 == 0 || per81 >= 999) return per81;
  return std::max(1, per81 * (W - 1) * (H - 1) / 81);
}
int t9_count(const Profile& P) {
  int n = 0;
  for (const auto& st : P.steps)
    if (st.tech == 9) n += st.count;
  return n;
}
bool in_window(const Profile& P, const LevelSpec& S) {
  // On large boards, forcing Easy below the combination-filter tier requires
  // extreme blackening; widen the window there instead.
  int hi = (S.hi == 4 && (W - 1) >= 10) ? 5 : S.hi;
  if (!P.solved_logically || P.hardest < S.lo || P.hardest > hi) return false;
  int t9 = t9_count(P);
  return t9 >= scale_t9(S.t9lo) && t9 <= scale_t9(S.t9hi);
}

struct Generated {
  Layout L;
  std::array<int, MAXN> solution{};
  Profile prof;
  int attempts = 0;
};

// Recompute run sums for the current layout from a full value assignment.
void recompute_sums(Layout& L, const std::array<int, MAXN>& sol) {
  for (auto& R : L.runs) {
    R.sum = 0;
    for (int c : R.cells) R.sum += sol[c];
  }
}

// Blacken cell (and its 180-degree partner), then repair any length-1 runs by
// further blackening.  Returns false if the board degrades (too few whites or
// disconnected).  The original fill remains a valid solution throughout.
bool blacken(Layout& L, int cell, bool symmetric = false) {
  L.black[cell] = 1;
  if (symmetric) {
    int r = cell / W, c = cell % W;
    L.black[(H - r) * W + (W - c)] = 1;
  }
  for (int iter = 0; iter < 200; ++iter) {
    bool changed = false;
    for (int rr = 1; rr < H; ++rr)
      for (int cc = 1; cc < W; ++cc) {
        int i = rr * W + cc;
        if (L.black[i]) continue;
        bool lB = L.black[i - 1], rB = (cc == W - 1) || L.black[i + 1];
        bool uB = L.black[i - W], dB = (rr == H - 1) || L.black[i + W];
        if ((lB && rB) || (uB && dB)) {
          L.black[i] = 1;
          changed = true;
        }
      }
    if (!changed) break;
  }
  int whites = 0, first = -1;
  for (int i = 0; i < N; ++i)
    if (!L.black[i]) { ++whites; if (first < 0) first = i; }
  if (whites < std::max(10, (W - 1) * (H - 1) / 7)) return false;
  std::vector<uint8_t> seen(N, 0);
  std::vector<int> stack{first};
  seen[first] = 1;
  int reached = 0;
  while (!stack.empty()) {
    int i = stack.back();
    stack.pop_back();
    ++reached;
    const int d[4] = {1, -1, W, -W};
    for (int k = 0; k < 4; ++k) {
      int j = i + d[k];
      if (j < 0 || j >= N) continue;
      if ((d[k] == 1 && j % W == 0) || (d[k] == -1 && i % W == 0)) continue;
      if (!L.black[j] && !seen[j]) { seen[j] = 1; stack.push_back(j); }
    }
  }
  if (reached != whites) return false;
  return build_runs(L);
}

// Eliminate always-swappable rectangles: cells (r1,c1),(r1,c2),(r2,c1),(r2,c2)
// with values a,b / b,a where each row pair shares an H-run and each column
// pair shares a V-run. Swapping such a rectangle preserves every constraint,
// so these are guaranteed non-uniqueness; blackening one corner removes the
// ambiguity structurally, without any solver call. Returns false if the board
// degrades below viability.
bool kill_rectangles(Layout& L, const std::array<int, MAXN>& sol, std::mt19937& rng) {
  for (int guard = 0; guard < 200; ++guard) {
    bool found = false;
    for (int i = 0; i < N && !found; ++i) {
      if (L.black[i]) continue;
      int r1 = i / W, c1 = i % W;
      for (int c2 = c1 + 1; c2 < W && !found; ++c2) {
        int j = r1 * W + c2;
        if (L.black[j] || L.hrun[i] != L.hrun[j]) continue;
        for (int r2 = r1 + 1; r2 < H && !found; ++r2) {
          int k = r2 * W + c1, l = r2 * W + c2;
          if (L.black[k] || L.black[l]) continue;
          if (L.hrun[k] != L.hrun[l]) continue;
          if (L.vrun[i] != L.vrun[k] || L.vrun[j] != L.vrun[l]) continue;
          if (sol[i] != sol[l] || sol[j] != sol[k] || sol[i] == sol[j]) continue;
          int corners[4] = {i, j, k, l};
          Layout backup = L;
          bool placed = false;
          int off = int(rng() % 4);
          for (int t = 0; t < 4 && !placed; ++t) {
            L = backup;
            if (blacken(L, corners[(t + off) % 4])) placed = true;
          }
          if (!placed) return false;
          found = true;
        }
      }
    }
    if (!found) return true;
  }
  return false;
}

bool gen_unique(Layout& L, std::array<int, MAXN>& sol, int blacks, std::mt19937& rng) {
  for (int lt = 0; lt < 30; ++lt) {
    if (!gen_layout(L, blacks, rng)) continue;
    if (!fill(L, sol, rng)) continue;
    if (!kill_rectangles(L, sol, rng)) continue;
    recompute_sums(L, sol);
    bool ok = false;
    for (int rep = 0; rep < 120; ++rep) {
      long nodes = 0;
      bool capped = false;
      std::vector<std::array<int, MAXN>> wit;
      int n = count_sol(L, 2, nodes, 1500000, capped, &wit);
      if (!capped && n == 1) { ok = true; break; }
      if (wit.size() < 2) break;                  // capped before 2 witnesses
      std::vector<int> diff;                      // cells where witnesses differ
      for (int i = 0; i < N; ++i)
        if (!L.black[i] && wit[0][i] != wit[1][i]) diff.push_back(i);
      if (diff.empty()) break;
      std::shuffle(diff.begin(), diff.end(), rng);
      // Fix several ambiguities per (expensive) solver round: blacken up to
      // three well-separated differing cells, each individually validated.
      int placed = 0, want = std::min<int>(3, std::max<int>(1, int(diff.size()) / 4));
      for (size_t t = 0; t < diff.size() && placed < want; ++t) {
        if (L.black[diff[t]]) continue;           // eaten by an earlier cascade
        Layout probe = L;
        if (blacken(probe, diff[t])) { L = probe; ++placed; }
      }
      if (!placed) break;
      recompute_sums(L, sol);
    }
    if (ok) {
      for (int i = 0; i < N; ++i)
        if (L.black[i]) sol[i] = 0;
      return true;
    }
  }
  return false;
}

Generated generate_level_impl(int level, std::mt19937& rng) {
  const LevelSpec& S = LEVELS[level];
  Generated best;
  int best_score = 1 << 30;
  for (int att = 1; att <= S.max_attempts; ++att) {
    Layout L;
    std::array<int, MAXN> sol{};
    // Larger boards tolerate less initial density (the length-1 repair
    // cascade compounds); the ease pass adds blacks afterwards as needed.
    int pct = (W - 1) >= 10 ? std::min(S.blacks_pct, 16) : S.blacks_pct;
    if (!gen_unique(L, sol, pct * (W - 1) * (H - 1) / 100, rng)) continue;
    Profile P = profile_puzzle(L);
    // Ease toward the window: extra blackening shortens runs, lowering both
    // the hardest tier and the run-analysis volume.  Keep a blackening only
    // if the puzzle stays unique and doesn't overshoot below the window.
    for (int tries = 0; tries < 50; ++tries) {
      if (in_window(P, S)) break;
      bool below = P.solved_logically &&
                   (P.hardest < S.lo || (P.hardest <= S.hi && t9_count(P) < scale_t9(S.t9lo)));
      if (below) break;                          // overshot; can't harden
      // Bias toward cells of the longest runs — those drive the hard steps.
      int lmax = 0;
      for (const auto& R : L.runs) lmax = std::max(lmax, int(R.cells.size()));
      std::vector<int> targets;
      for (const auto& R : L.runs)
        if (int(R.cells.size()) + 1 >= lmax)
          for (int c : R.cells) targets.push_back(c);
      if (targets.empty()) break;
      Layout L2 = L;
      if (!blacken(L2, targets[rng() % targets.size()])) continue;
      recompute_sums(L2, sol);
      long nodes = 0;
      bool capped = false;
      if (count_sol(L2, 2, nodes, 600000, capped) != 1 || capped) continue;
      Profile P2 = profile_puzzle(L2);
      bool below2 = P2.solved_logically &&
                    (P2.hardest < S.lo || (P2.hardest <= S.hi && t9_count(P2) < scale_t9(S.t9lo)));
      if (below2 && !in_window(P2, S)) continue; // would overshoot: reject
      L = L2;
      P = P2;
    }
    for (int i = 0; i < N; ++i)
      if (L.black[i]) sol[i] = 0;
    int h = P.hardest;
    bool in_win = in_window(P, S);
    int t9d = std::max(0, std::max(scale_t9(S.t9lo) - t9_count(P), t9_count(P) - scale_t9(S.t9hi)));
    int score = in_win ? 0
              : (P.solved_logically ? 1 + std::abs(h - (S.lo + S.hi) / 2) + t9d
                                    : 1000 + std::max(0, S.lo - h));
    if (score < best_score) {
      best_score = score;
      best.L = L;
      best.solution = sol;
      best.prof = P;
      best.attempts = att;
      if (score == 0) break;
    }
  }
  return best;
}

// ------------------------------------------------------------------- JSON --
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

Layout g_layout;
std::array<int, MAXN> g_solution{};
std::string g_result;

}  // namespace

// ========================== public evaluation API ===========================
/// Evaluate an arbitrary Kakuro instance and produce its difficulty profile.
///
/// Intended entry point for external puzzle-generation research: hand it a
/// candidate instance; it returns the full solving Profile or the reason the
/// instance is unusable.
///
/// IMPORTANT: the engine's board dimensions (W, H, N) are process-global.
/// Call set_board_size(playable) BEFORE building a Layout, and do not change
/// it between building and evaluating. The string-based evaluate_kakuro()
/// export handles sizing automatically and restores the previous dimensions.
///
/// A valid Layout must satisfy (checked; violations -> InvalidInstance):
///   - every non-black cell belongs to exactly one horizontal and one
///     vertical run (hrun/vrun set; use build_runs() to derive them);
///   - every run has 2..9 cells, all non-black, and a sum in [3, 45].
///
/// @param search_cap node budget for the uniqueness search.
/// @return the Profile from the 9-tier technique ladder (see TECHS), or:
///         - EvalError::InvalidInstance     malformed layout (see above)
///         - EvalError::NoSolution          the sums admit no assignment
///         - EvalError::MultipleSolutions   at least two assignments exist
///         - EvalError::SearchLimitExceeded search_cap hit before deciding
///
/// Profile.solved_logically == false means the instance is valid (unique)
/// but needs search beyond the ladder; hardest/steps still describe how far
/// pure technique application gets.
Expected<Profile, EvalError> evaluate_puzzle(const Layout& L,
                                             long long search_cap = 20000000) {
  for (size_t j = 0; j < L.runs.size(); ++j) {
    const Run& R = L.runs[j];
    int k = int(R.cells.size());
    if (k < 2 || k > 9 || R.sum < 3 || R.sum > 45)
      return Unexpected<EvalError>(EvalError::InvalidInstance);
    int mn = k * (k + 1) / 2, mx = k * (19 - k) / 2;
    if (R.sum < mn || R.sum > mx)
      return Unexpected<EvalError>(EvalError::NoSolution);
    for (int c : R.cells) {
      if (c < 0 || c >= N || L.black[c])
        return Unexpected<EvalError>(EvalError::InvalidInstance);
      if ((R.horiz ? L.hrun[c] : L.vrun[c]) != int(j))
        return Unexpected<EvalError>(EvalError::InvalidInstance);
    }
  }
  if (L.runs.empty()) return Unexpected<EvalError>(EvalError::InvalidInstance);
  for (int i = 0; i < N; ++i)
    if (!L.black[i] &&
        (L.hrun[i] < 0 || L.hrun[i] >= int(L.runs.size()) ||
         L.vrun[i] < 0 || L.vrun[i] >= int(L.runs.size()) ||
         !L.runs[L.hrun[i]].horiz || L.runs[L.vrun[i]].horiz))
      return Unexpected<EvalError>(EvalError::InvalidInstance);
  long nodes = 0;
  bool capped = false;
  int n = count_sol(L, 2, nodes, search_cap, capped);
  if (capped) return Unexpected<EvalError>(EvalError::SearchLimitExceeded);
  if (n == 0) return Unexpected<EvalError>(EvalError::NoSolution);
  if (n >= 2) return Unexpected<EvalError>(EvalError::MultipleSolutions);
  return profile_puzzle(L);
}

extern "C" {

// JSON wrapper around evaluate_puzzle. Spec format (matches the generator's
// JSON): "W,H;sum,horiz,cell,cell,...;sum,horiz,cell,..." with W == H.
// Returns {"status":"ok",...profile...} or {"status":"invalid_instance" |
// "no_solution" | "multiple_solutions" | "search_limit_exceeded"}.
// The engine's current board size is restored afterwards.
EXPORT const char* evaluate_kakuro(const char* spec) {
  int oldW = W, oldH = H;
  auto restore = [&]() { W = oldW; H = oldH; N = W * H; };
  std::vector<long> nums;
  std::vector<std::vector<long>> groups;
  {
    std::vector<long> cur;
    long v = 0;
    bool have = false;
    for (const char* p = spec;; ++p) {
      if (*p >= '0' && *p <= '9') { v = v * 10 + (*p - '0'); have = true; }
      else {
        if (have) cur.push_back(v);
        v = 0; have = false;
        if (*p == ';' || *p == 0) {
          if (!cur.empty()) groups.push_back(cur);
          cur.clear();
          if (*p == 0) break;
        }
      }
    }
  }
  auto fail = [&](const char* what) {
    restore();
    g_result = std::string("{\"status\":\"") + what + "\"}";
    return g_result.c_str();
  };
  if (groups.empty() || groups[0].size() != 2) return fail("invalid_instance");
  if (groups[0][0] != groups[0][1]) return fail("invalid_instance");
  int playable = int(groups[0][0]) - 1;
  if (playable < 5 || playable > MAXW - 1) return fail("invalid_instance");
  set_board_size(playable);
  Layout L;
  L.black.fill(1);
  L.hrun.fill(-1);
  L.vrun.fill(-1);
  for (size_t g = 1; g < groups.size(); ++g) {
    const auto& t = groups[g];
    if (t.size() < 4) return fail("invalid_instance");
    Run R;
    R.sum = int(t[0]);
    R.horiz = t[1] != 0;
    for (size_t k = 2; k < t.size(); ++k) {
      int c = int(t[k]);
      if (c < 0 || c >= N) return fail("invalid_instance");
      R.cells.push_back(c);
      L.black[c] = 0;
      (R.horiz ? L.hrun : L.vrun)[c] = int(L.runs.size());
    }
    L.runs.push_back(std::move(R));
  }
  auto res = evaluate_puzzle(L);
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
  restore();
  return g_result.c_str();
}


EXPORT const char* generate_kakuro(int level, int size, unsigned seed) {
  level = std::max(0, std::min(3, level));
  set_board_size(size);
  std::mt19937 rng(seed);
  Generated G = generate_level_impl(level, rng);
  g_layout = G.L;
  g_solution = G.solution;
  g_result = "{\"kind\":\"kakuro\",\"W\":" + std::to_string(W) + ",\"H\":" + std::to_string(H) + ",\"level\":\"";
  g_result += LEVELS[level].name;
  g_result += "\",\"attempts\":" + std::to_string(G.attempts) + ",\"runs\":[";
  for (size_t j = 0; j < G.L.runs.size(); ++j) {
    if (j) g_result += ',';
    const Run& R = G.L.runs[j];
    g_result += '[' + std::to_string(R.sum) + ',' + (R.horiz ? "1" : "0");
    for (int c : R.cells) g_result += ',' + std::to_string(c);
    g_result += ']';
  }
  g_result += "],\"solution\":\"";
  for (int i = 0; i < N; ++i) g_result += char('0' + G.solution[i]);
  g_result += "\",";
  append_profile_json(g_result, G.prof);
  g_result += '}';
  return g_result.c_str();
}

// kakuro_hint(values100, elim_csv): uses the last generated puzzle.
EXPORT const char* kakuro_hint(const char* values100, const char* elim_csv) {
  std::array<int, MAXN> values{};
  for (int i = 0; i < N && values100[i]; ++i)
    values[i] = (values100[i] >= '1' && values100[i] <= '9') ? values100[i] - '0' : 0;
  std::array<Mask, MAXN> user_elim{};
  {
    int i = 0;
    for (const char* p = elim_csv; *p && i < N; ++i) {
      int v = 0;
      while (*p >= '0' && *p <= '9') v = v * 10 + (*p++ - '0');
      if (*p == ',') ++p;
      user_elim[i] = Mask(v) & ALL;
    }
  }
  std::vector<int> bad;
  for (int i = 0; i < N; ++i)
    if (!g_layout.black[i] && values[i] && values[i] != g_solution[i]) bad.push_back(i);
  if (!bad.empty()) {
    g_result = "{\"error\":\"mistakes\",";
    append_cells_json(g_result, "cells", bad);
    g_result += '}';
    return g_result.c_str();
  }
  for (int i = 0; i < N; ++i)
    if (!g_layout.black[i] && !values[i] && (user_elim[i] & (1 << g_solution[i]))) bad.push_back(i);
  if (!bad.empty()) {
    g_result = "{\"error\":\"badnotes\",";
    append_cells_json(g_result, "cells", bad);
    g_result += '}';
    return g_result.c_str();
  }

  KS s;
  s.init(g_layout);
  for (int i = 0; i < N; ++i)
    if (values[i]) s.place(i, values[i]);
  if (s.solved()) { g_result = "{\"error\":\"solved\"}"; return g_result.c_str(); }
  for (int i = 0; i < N; ++i) s.cand[i] &= ~user_elim[i];

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
int main() {
  // sanity: 2 cells / sum 3 -> exactly {1,2}
  if (CB.c[2][3].size() != 1 || CB.c[2][3][0] != Mask((1 << 1) | (1 << 2))) {
    std::printf("COMBOS broken\n");
    return 1;
  }
  // 1. per-technique soundness fuzz
  {
    std::mt19937 rng(777);
    long fired[NUM_TECH + 1] = {};
    for (int iter = 0; iter < 1500; ++iter) {
      Layout L;
      std::array<int, MAXN> sol{};
      if (!gen_layout(L, 18, rng)) continue;
      if (!fill(L, sol, rng)) continue;
      for (size_t j = 0; j < L.runs.size(); ++j) {
        L.runs[j].sum = 0;
        for (int c : L.runs[j].cells) L.runs[j].sum += sol[c];
      }
      for (int tier = 1; tier <= NUM_TECH; ++tier) {
        KS s;
        s.init(L);
        for (int i = 0; i < N; ++i)                 // random consistent partial
          if (!L.black[i] && rng() % 3 == 0) s.place(i, sol[i]);
        for (int i = 0; i < N; ++i)                 // random true-preserving strikes
          if (!L.black[i] && !s.val[i])
            for (int d = 1; d <= 9; ++d)
              if (d != sol[i] && (s.cand[i] & (1 << d)) && rng() % 4 == 0)
                s.cand[i] &= ~Mask(1 << d);
        fired[tier] += run_tech(tier, s);
        for (int i = 0; i < N; ++i) {
          if (L.black[i]) continue;
          if (s.val[i] && s.val[i] != sol[i]) { std::printf("tier %d WRONG PLACE\n", tier); return 1; }
          if (!s.val[i] && !(s.cand[i] & (1 << sol[i]))) { std::printf("tier %d UNSOUND ELIM\n", tier); return 1; }
        }
      }
    }
    for (int t = 1; t <= NUM_TECH; ++t)
      std::printf("tier %d %-18s: %ld sound applications\n", t, TECHS[t].name, fired[t]);
  }
  // 2. level generation: window hit rate + timing
  for (int level = 0; level < 4; ++level) {
    int hit = 0;
    long ms_total = 0, att_total = 0;
    int n_puz = 10;
    for (int t = 0; t < n_puz; ++t) {
      auto t0 = std::chrono::steady_clock::now();
      std::mt19937 rng(9000 + level * 100 + t);
      Generated G = generate_level_impl(level, rng);
      ms_total += std::chrono::duration_cast<std::chrono::milliseconds>(
                      std::chrono::steady_clock::now() - t0).count();
      att_total += G.attempts;
      const LevelSpec& S = LEVELS[level];
      if (G.prof.solved_logically && G.prof.hardest >= S.lo && G.prof.hardest <= S.hi) ++hit;
      // verify uniqueness + solution validity of the shipped puzzle
      long nodes = 0; bool capped = false;
      if (count_sol(G.L, 2, nodes, 2000000, capped) != 1 || capped) { std::printf("NOT UNIQUE!\n"); return 1; }
      for (const auto& R : G.L.runs) {
        int s = 0; Mask u = 0;
        for (int c : R.cells) { s += G.solution[c]; if (u & (1 << G.solution[c])) { std::printf("DUP!\n"); return 1; } u |= 1 << G.solution[c]; }
        if (s != R.sum) { std::printf("BAD SUM!\n"); return 1; }
      }
    }
    std::printf("%-7s: window hit %d/%d, avg attempts %ld, avg %ld ms\n",
                LEVELS[level].name, hit, n_puz, att_total / n_puz, ms_total / n_puz);
  }
  return 0;
}
#endif
