import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/**
 * Evolves hard Blocked levels: random small boards, mutated one change at a
 * time (simulated annealing), scored with rating.py's formula, kept only if an
 * exact breadth-first search (same rules as solver.py / fast.py) can solve them.
 *
 *   java -Xmx24g -cp jsolve Evolve <outDir> <threads> <minutes> [seed]
 *
 * Each thread writes its best levels to outDir/best-<thread>.txt. Results are
 * candidates only: tools/hard.py re-checks them with the Python rules.
 */
public class Evolve {
    // ---------------- rules (a copy of fast.py, instance-based) ----------------
    static final int[] DX = {0, 0, -1, 1}, DY = {-1, 1, 0, 0};
    static final char[] DC = {'U', 'D', 'L', 'R'};

    static final class Lvl {
        int W, H, N, WORDS;
        char[] g;                   // '#', '.', 'P', 'E', 'B', '_', 'F', cannons '^' 'v' '<' '>'
        boolean[] boxStart;          // a crate starts here (may be on a plate or fuse)
        int[] plateTo, fuseTo;       // per cell: linked target, or -1
        Lvl copy() {
            Lvl o = new Lvl();
            o.W = W; o.H = H; o.N = N; o.WORDS = WORDS;
            o.g = g.clone(); o.boxStart = boxStart.clone(); o.plateTo = plateTo.clone(); o.fuseTo = fuseTo.clone();
            return o;
        }
        String mapString() {
            StringBuilder sb = new StringBuilder();
            for (int y = 0; y < H; y++) {
                for (int x = 0; x < W; x++) {
                    int i = y * W + x;
                    char c = g[i];
                    if (boxStart[i]) c = c == '_' ? '=' : 'B';
                    else if (c == '.' && isGateCell(i)) c = 'D';
                    sb.append(c);
                }
                sb.append('\n');
            }
            return sb.toString();
        }
        boolean isGateCell(int i) { for (int p = 0; p < N; p++) if (plateTo[p] == i) return true; return false; }
        String linksString() {
            StringBuilder sb = new StringBuilder();
            for (int i = 0; i < N; i++) {
                if (plateTo[i] >= 0) sb.append(i % W).append(',').append(i / W).append("->").append(plateTo[i] % W).append(',').append(plateTo[i] / W).append(' ');
                if (fuseTo[i] >= 0) sb.append(i % W).append(',').append(i / W).append("->").append(fuseTo[i] % W).append(',').append(fuseTo[i] / W).append(' ');
            }
            return sb.toString().trim();
        }
    }

    static boolean isCannon(char c) { return c == '^' || c == 'v' || c == '<' || c == '>'; }

    /** Compiled rules for one level, plus an exact BFS. Not thread-safe; one per thread. */
    static final class Game {
        final Lvl L;
        final int W, H, N, WORDS, STRIDE;
        final long[] walls0, boxes0, cannons, gates, exits;
        final int[] cdx, cdy, ctrl, nb;
        final int[][] gateOrder, fuses, ring;
        int player;
        final boolean noSqueeze;   // the old rule: a gate stays jammed open while anything stands in it
        Game(Lvl lv) { this(lv, false); }
        Game(Lvl lv, boolean noSqueeze) {
            this.noSqueeze = noSqueeze;
            L = lv; W = lv.W; H = lv.H; N = W * H; WORDS = (N + 63) / 64; STRIDE = 1 + 2 * WORDS;
            walls0 = new long[WORDS]; boxes0 = new long[WORDS]; cannons = new long[WORDS]; gates = new long[WORDS]; exits = new long[WORDS];
            cdx = new int[N]; cdy = new int[N]; ctrl = new int[N]; Arrays.fill(ctrl, -1);
            nb = new int[N * 4];
            List<int[]> pl = new ArrayList<>(), fu = new ArrayList<>();
            for (int i = 0; i < N; i++) {
                char c = lv.g[i];
                if (c == '#') set(walls0, i);
                if (c == 'P') player = i;
                if (c == 'E') set(exits, i);
                if (lv.boxStart[i]) set(boxes0, i);
                if (isCannon(c)) {
                    set(cannons, i);
                    cdx[i] = c == '<' ? -1 : c == '>' ? 1 : 0;
                    cdy[i] = c == '^' ? -1 : c == 'v' ? 1 : 0;
                }
            }
            for (int i = 0; i < N; i++) {
                if (lv.g[i] == '_' && lv.plateTo[i] >= 0 && !get(cannons, lv.plateTo[i])) pl.add(new int[]{i, lv.plateTo[i]});
                if (lv.g[i] == 'F' && lv.fuseTo[i] >= 0 && get(cannons, lv.fuseTo[i])) fu.add(new int[]{i, lv.fuseTo[i]});
            }
            for (int[] p : pl) { set(gates, p[1]); ctrl[p[1]] = p[0]; }
            List<int[]> go = new ArrayList<>();
            for (int[] p : pl) if (ctrl[p[1]] == p[0]) go.add(p);
            gateOrder = go.toArray(new int[0][]);
            fuses = fu.toArray(new int[0][]);
            ring = new int[N][];
            for (int[] p : gateOrder) {
                int t = p[1], gx = t % W, gy = t / W;
                List<Integer> o = new ArrayList<>();
                for (int r = 1; r < Math.max(W, H); r++)
                    for (int y = gy - r; y <= gy + r; y++)
                        for (int x = gx + r; x >= gx - r; x--)
                            if (Math.max(Math.abs(x - gx), Math.abs(y - gy)) == r && x >= 0 && y >= 0 && x < W && y < H) o.add(y * W + x);
                ring[t] = o.stream().mapToInt(Integer::intValue).toArray();
            }
            for (int c = 0; c < N; c++) for (int d = 0; d < 4; d++) nb[c * 4 + d] = cellAt(c, DX[d], DY[d]);
        }
        static boolean get(long[] a, int i) { return (a[i >> 6] >>> (i & 63) & 1L) != 0; }
        static void set(long[] a, int i) { a[i >> 6] |= 1L << (i & 63); }
        static void clr(long[] a, int i) { a[i >> 6] &= ~(1L << (i & 63)); }
        int cellAt(int c, int dx, int dy) {
            int x = c % W + dx, y = c / W + dy;
            return (x >= 0 && y >= 0 && x < W && y < H) ? y * W + x : -1;
        }
        // events seen during checks (for "does this mechanic get used")
        boolean evSqueeze, evShot;
        boolean settlePlates(int p, long[] boxes, long[] walls) {
            for (int pass = 0; pass < 10; pass++) {
                boolean squeezed = false;
                for (int[] pt : gateOrder) {
                    int plate = pt[0], t = pt[1];
                    if (plate == p || get(boxes, plate)) clr(walls, t);
                    else if (!get(walls, t)) {
                        if (noSqueeze && (t == p || get(boxes, t))) continue;
                        if (t == p) return false;
                        if (get(boxes, t)) {
                            clr(boxes, t);
                            for (int c : ring[t])
                                if (c != p && !get(walls, c) && !get(boxes, c) && !get(cannons, c)) { set(boxes, c); break; }
                            squeezed = true; evSqueeze = true;
                        }
                        set(walls, t);
                    }
                }
                if (!squeezed) break;
            }
            return true;
        }
        boolean checks(int p, long[] boxes, long[] walls) {
            if (!settlePlates(p, boxes, walls)) return false;
            for (int[] f : fuses) {
                if (!(f[0] == p || get(boxes, f[0]))) continue;
                int c = f[1], dx = cdx[c], dy = cdy[c];
                int cur = cellAt(c, dx, dy);
                if (cur < 0 || !get(boxes, cur)) continue;
                evShot = true;
                while (true) {
                    int n = cellAt(cur, dx, dy);
                    if (n == p) return false;
                    if (n < 0 || get(boxes, n) || get(walls, n)) {
                        if (n >= 0 && get(walls, n) && !get(gates, n)) clr(walls, n);
                        clr(boxes, cur);
                        if (n >= 0 && get(boxes, n)) clr(boxes, n);
                        if (!settlePlates(p, boxes, walls)) return false;
                        break;
                    }
                    clr(boxes, cur); set(boxes, n); cur = n;
                    if (!settlePlates(p, boxes, walls)) return false;
                    if (!get(boxes, cur)) break;
                }
            }
            return true;
        }
        long[] rb, rw; int rp; boolean rPush;
        boolean move(int p, long[] boxes, long[] walls, int d) {
            int n = nb[p * 4 + d];
            if (n < 0 || get(walls, n) || get(cannons, n)) return false;
            rb = boxes.clone(); rw = walls.clone(); rPush = false;
            int b = -1;
            if (get(boxes, n)) {
                b = nb[n * 4 + d];
                if (b < 0 || get(walls, b) || get(boxes, b) || get(cannons, b)) return false;
                clr(rb, n); set(rb, b); rPush = true;
            }
            if (get(gates, n) && !(ctrl[n] == n || get(rb, ctrl[n]))) return false;
            if (b >= 0 && get(gates, b) && !(ctrl[b] == n || get(rb, ctrl[b]))) return false;
            if (!checks(n, rb, rw)) return false;
            rp = n;
            return true;
        }

        // ---- exact BFS with forgiveness stats ----
        // Search buffers are big, so each thread reuses its own (see Buf).
        long[] arena; int count, cap; int[] table, parent, edgeStart, edges; int edgeCount; byte[] pdir;
        long[] tmp;
        long hash(long[] a) {
            long h = 0x9E3779B97F4A7C15L;
            for (int i = 0; i < STRIDE; i++) { h ^= a[i]; h *= 0xBF58476D1CE4E5B9L; h ^= h >>> 31; }
            return h;
        }
        int add(int p, long[] boxes, long[] walls, int par, int d) {
            tmp[0] = p;
            System.arraycopy(boxes, 0, tmp, 1, WORDS);
            System.arraycopy(walls, 0, tmp, 1 + WORDS, WORDS);
            int mask = table.length - 1, slot = (int) (hash(tmp) & mask);
            while (table[slot] != 0) {
                int idx = table[slot] - 1, off = idx * STRIDE;
                boolean eq = true;
                for (int i = 0; i < STRIDE; i++) if (arena[off + i] != tmp[i]) { eq = false; break; }
                if (eq) return idx;
                slot = (slot + 1) & mask;
            }
            if (count >= cap) return -2;
            System.arraycopy(tmp, 0, arena, count * STRIDE, STRIDE);
            parent[count] = par; pdir[count] = (byte) d;
            table[slot] = count + 1;
            return count++;
        }
        static final class Result { boolean solvable, truncated; int moves, pushes, states; double ruin; String solution; boolean usedSqueeze, usedShot; }

        Result solve(int capStates) {
            cap = Math.min(capStates, Buf.MAX);
            Buf buf = BUF.get();
            arena = buf.arena; table = buf.table; parent = buf.parent; pdir = buf.pdir;
            edgeStart = buf.edgeStart; edges = buf.edges; edgeCount = 0;
            Arrays.fill(table, 0);
            tmp = new long[STRIDE];
            Result r = new Result();
            long[] b0 = boxes0.clone(), w0 = walls0.clone();
            if (!checks(player, b0, w0)) return r;
            count = 0;
            add(player, b0, w0, -1, 0);
            long[] boxes = new long[WORDS], walls = new long[WORDS];
            List<Integer> wins = new ArrayList<>();
            int firstWin = -1;
            for (int head = 0; head < count; head++) {
                int off = head * STRIDE, p = (int) arena[off];
                edgeStart[head] = edgeCount;
                if (get(exits, p)) { wins.add(head); if (firstWin < 0) firstWin = head; continue; }
                System.arraycopy(arena, off + 1, boxes, 0, WORDS);
                System.arraycopy(arena, off + 1 + WORDS, walls, 0, WORDS);
                for (int d = 0; d < 4; d++) {
                    if (!move(p, boxes, walls, d)) continue;
                    int k = add(rp, rb, rw, head, d);
                    if (k == -2) { r.truncated = true; return r; }
                    if (k != head) edges[edgeCount++] = k;
                }
            }
            edgeStart[count] = edgeCount;
            r.states = count;
            if (firstWin < 0) return r;
            r.solvable = true;
            StringBuilder sb = new StringBuilder();
            for (int k = firstWin; parent[k] >= 0; k = parent[k]) sb.append(DC[pdir[k]]);
            r.solution = sb.reverse().toString();
            r.moves = r.solution.length();
            // replay for pushes and mechanic use
            long[] bb = boxes0.clone(), ww = walls0.clone();
            evSqueeze = false; evShot = false;
            checks(player, bb, ww);
            int pp = player;
            for (char c : r.solution.toCharArray()) {
                int d = c == 'U' ? 0 : c == 'D' ? 1 : c == 'L' ? 2 : 3;
                move(pp, bb, ww, d);
                if (rPush) r.pushes++;
                pp = rp; bb = rb; ww = rw;
            }
            r.usedSqueeze = evSqueeze; r.usedShot = evShot;
            // forgiveness: share of crate pushes from live states that lead to dead states
            boolean[] alive = new boolean[count];
            int[] rc = new int[count + 1];
            for (int s = 0; s < count; s++) for (int e = edgeStart[s]; e < edgeStart[s + 1]; e++) rc[edges[e] + 1]++;
            for (int i = 0; i < count; i++) rc[i + 1] += rc[i];
            int[] radj = new int[edgeCount], fill = rc.clone();
            for (int s = 0; s < count; s++) for (int e = edgeStart[s]; e < edgeStart[s + 1]; e++) radj[fill[edges[e]]++] = s;
            ArrayDeque<Integer> q = new ArrayDeque<>();
            for (int w : wins) { alive[w] = true; q.add(w); }
            while (!q.isEmpty()) {
                int s = q.poll();
                for (int e = rc[s]; e < rc[s + 1]; e++) { int pr = radj[e]; if (!alive[pr]) { alive[pr] = true; q.add(pr); } }
            }
            long livePush = 0, ruinPush = 0;
            for (int s = 0; s < count; s++) {
                if (!alive[s]) continue;
                int so = s * STRIDE;
                for (int e = edgeStart[s]; e < edgeStart[s + 1]; e++) {
                    int n = edges[e], no = n * STRIDE;
                    boolean pushed = false;
                    for (int i = 1; i <= WORDS; i++) if (arena[so + i] != arena[no + i]) { pushed = true; break; }
                    if (pushed) { livePush++; if (!alive[n]) ruinPush++; }
                }
            }
            r.ruin = livePush == 0 ? 0 : (double) ruinPush / livePush;
            arena = null; table = null; edges = null;
            return r;
        }
    }

    static final class Buf {
        static final int MAX = 1_500_000, MAX_STRIDE = 7;   // boards up to 192 squares
        final long[] arena = new long[MAX * MAX_STRIDE];
        final int[] table = new int[Integer.highestOneBit(MAX) << 1];
        final int[] parent = new int[MAX], edgeStart = new int[MAX + 1], edges = new int[MAX * 4];
        final byte[] pdir = new byte[MAX];
    }
    static final ThreadLocal<Buf> BUF = ThreadLocal.withInitial(Buf::new);

    // ---------------- scoring (rating.py's formula + filler penalties) ----------------
    static double ratingScore(int moves, int pushes, int states, double ruin, int mech) {
        return 1.2 * log2(1 + pushes) + 1.0 * log2(1 + moves / 10.0) + 3.0 * ruin + 0.45 * Math.log10(Math.max(states, 1)) + 0.5 * mech;
    }
    static double log2(double v) { return Math.log(v) / Math.log(2); }

    static int BIG_STATES = 300_000;   // gently discourage state spaces bigger than this (Refine raises it)
    static final class Eval { Game.Result r; double score, rating; String why = ""; int unneeded = -1; }

    static boolean solvableVariant(Lvl lv, boolean noSqueeze) {
        Game.Result r = new Game(lv, noSqueeze).solve(300_000);
        return r.solvable || r.truncated;   // too big to tell: assume the piece might not be needed
    }

    /** How many pieces the level could do without: crates, gates (walled up), cannons (walled up),
     *  and the squeeze (solvable under the old jam rule). Each one is filler. */
    static int unneeded(Lvl lv, Game.Result base) {
        int n = 0;
        for (int i = 0; i < lv.N; i++) {
            if (lv.boxStart[i]) {
                Lvl v = lv.copy(); v.boxStart[i] = false;
                if (solvableVariant(v, false)) n++;
            }
            if (lv.g[i] == '_' && lv.plateTo[i] >= 0) {
                Lvl v = lv.copy(); v.g[v.plateTo[i]] = '#'; v.plateTo[i] = -1;
                if (solvableVariant(v, false)) n++;
            }
            if (isCannon(lv.g[i])) {
                Lvl v = lv.copy(); v.g[i] = '#';
                for (int f = 0; f < v.N; f++) if (v.fuseTo[f] == i) v.fuseTo[f] = -1;
                if (solvableVariant(v, false)) n++;
            }
        }
        if (base.usedSqueeze && solvableVariant(lv, true)) n++;
        return n;
    }

    static Eval evaluate(Lvl lv, int cap) {
        Eval e = new Eval();
        Game g = new Game(lv);
        e.r = g.solve(cap);
        if (!e.r.solvable) { e.score = -1e9; return e; }
        int mech = 0;
        boolean hasPlates = false, hasFuses = false;
        for (char c : lv.g) { if (c == '_') hasPlates = true; if (c == 'F') hasFuses = true; }
        mech = (hasPlates ? 1 : 0) + (hasFuses ? 1 : 0);
        e.rating = ratingScore(e.r.moves, e.r.pushes, e.r.states, e.r.ruin, mech);
        // Filler: crates never pushed, plates never pressed, cannons never fired, floor never touched.
        Set<Integer> touched = new HashSet<>(), pushedFrom = new HashSet<>(), pressed = new HashSet<>();
        long[] bb = g.boxes0.clone(), ww = g.walls0.clone();
        g.checks(g.player, bb, ww);
        int pp = g.player;
        touched.add(pp);
        for (char c : e.r.solution.toCharArray()) {
            int d = c == 'U' ? 0 : c == 'D' ? 1 : c == 'L' ? 2 : 3;
            g.move(pp, bb, ww, d);
            pp = g.rp; bb = g.rb; ww = g.rw;
            touched.add(pp);
            for (int i = 0; i < g.N; i++) if (Game.get(bb, i)) touched.add(i);
            if (g.rPush) pushedFrom.add(pp);
            for (int[] pt : g.gateOrder) if (pt[0] == pp || Game.get(bb, pt[0])) pressed.add(pt[0]);
        }
        int crates = 0, idleCrates = 0;
        // a crate counts as used if its start square was ever left empty
        for (int i = 0; i < g.N; i++) if (lv.boxStart[i]) crates++;
        Set<Integer> emptied = new HashSet<>();
        bb = g.boxes0.clone(); ww = g.walls0.clone(); g.checks(g.player, bb, ww); pp = g.player;
        for (char c : e.r.solution.toCharArray()) {
            int d = c == 'U' ? 0 : c == 'D' ? 1 : c == 'L' ? 2 : 3;
            g.move(pp, bb, ww, d); pp = g.rp; bb = g.rb; ww = g.rw;
            for (int i = 0; i < g.N; i++) if (lv.boxStart[i] && !Game.get(bb, i)) emptied.add(i);
        }
        for (int i = 0; i < g.N; i++) if (lv.boxStart[i] && !emptied.contains(i)) idleCrates++;
        int idlePlates = 0;
        for (int[] pt : g.gateOrder) if (!pressed.contains(pt[0])) idlePlates++;
        int idleCannons = (g.fuses.length > 0 && !e.r.usedShot) ? g.fuses.length : 0;
        int floor = 0, untouched = 0;
        for (int i = 0; i < g.N; i++) {
            char c = lv.g[i];
            if (c != '#' && !isCannon(c) && c != 'E') { floor++; if (!touched.contains(i)) untouched++; }
        }
        double pen = 1.6 * idleCrates + 1.6 * idlePlates + 1.6 * idleCannons + 0.2 * untouched;
        // keep the hint solver usable on most of them: gently discourage huge state spaces
        if (e.r.states > BIG_STATES) pen += 0.5 * Math.log10(e.r.states / (double) BIG_STATES);
        e.score = e.rating - pen;
        e.why = String.format("crates=%d idle=%d plates idle=%d cannons idle=%d untouched=%d/%d squeeze=%b shot=%b",
                crates, idleCrates, idlePlates, idleCannons, untouched, floor, e.r.usedSqueeze, e.r.usedShot);
        return e;
    }

    // ---------------- random levels and mutations ----------------
    static final class Style { String name; int maxCrates, maxPlates, maxCannons; Style(String n, int c, int p, int k) { name = n; maxCrates = c; maxPlates = p; maxCannons = k; } }
    static final Style[] STYLES = {
        new Style("crates", 6, 0, 0),
        new Style("plates", 5, 3, 0),
        new Style("squeeze", 5, 2, 0),
        new Style("cannons", 5, 0, 2),
        new Style("mixed", 5, 2, 1),
    };

    static Lvl randomLevel(Random rnd, int W, int H, Style st) {
        Lvl lv = new Lvl();
        lv.W = W; lv.H = H; lv.N = W * H; lv.WORDS = (lv.N + 63) / 64;
        lv.g = new char[lv.N]; lv.boxStart = new boolean[lv.N]; lv.plateTo = new int[lv.N]; lv.fuseTo = new int[lv.N];
        Arrays.fill(lv.plateTo, -1); Arrays.fill(lv.fuseTo, -1);
        for (int y = 0; y < H; y++) for (int x = 0; x < W; x++) {
            boolean border = x == 0 || y == 0 || x == W - 1 || y == H - 1;
            lv.g[y * W + x] = border || rnd.nextDouble() < 0.25 ? '#' : '.';
        }
        int p = randomEmpty(rnd, lv); lv.g[p] = 'P';
        // exit on the right wall
        int ey = 1 + rnd.nextInt(H - 2); lv.g[ey * W + W - 1] = 'E'; lv.g[ey * W + W - 2] = '.';
        for (int i = 0; i < 2 + rnd.nextInt(2); i++) { int c = randomEmpty(rnd, lv); if (c >= 0) lv.boxStart[c] = true; }
        return lv;
    }

    static int randomEmpty(Random rnd, Lvl lv) {
        for (int tries = 0; tries < 200; tries++) {
            int x = 1 + rnd.nextInt(lv.W - 2), y = 1 + rnd.nextInt(lv.H - 2), i = y * lv.W + x;
            if (lv.g[i] == '.' && !lv.boxStart[i] && !lv.isGateCell(i)) return i;
        }
        return -1;
    }

    static int countCrates(Lvl lv) { int n = 0; for (boolean b : lv.boxStart) if (b) n++; return n; }
    static int countChar(Lvl lv, char ch) { int n = 0; for (char c : lv.g) if (c == ch) n++; return n; }

    static Lvl mutate(Random rnd, Lvl src, Style st) {
        Lvl lv = src.copy();
        int W = lv.W, H = lv.H;
        int kind = rnd.nextInt(12);
        switch (kind) {
            case 0: case 1: case 2: { // flip a wall/floor square
                int x = 1 + rnd.nextInt(W - 2), y = 1 + rnd.nextInt(H - 2), i = y * W + x;
                if (lv.g[i] == '#') lv.g[i] = '.';
                else if (lv.g[i] == '.' && !lv.boxStart[i] && !lv.isGateCell(i)) lv.g[i] = '#';
                break;
            }
            case 3: case 4: { // move a crate
                List<Integer> cs = new ArrayList<>();
                for (int i = 0; i < lv.N; i++) if (lv.boxStart[i]) cs.add(i);
                if (cs.isEmpty()) break;
                int from = cs.get(rnd.nextInt(cs.size()));
                int to = randomEmpty(rnd, lv);
                if (rnd.nextBoolean()) { // nudge to a neighbour instead
                    int d = rnd.nextInt(4), n = from + DX[d] + DY[d] * W;
                    to = (lv.g[n] == '.' || lv.g[n] == '_') && !lv.boxStart[n] && !lv.isGateCell(n) ? n : -1;
                }
                if (to >= 0) { lv.boxStart[from] = false; lv.boxStart[to] = true; }
                break;
            }
            case 5: { // add or remove a crate
                int n = countCrates(lv);
                if (n < st.maxCrates && (n < 2 || rnd.nextBoolean())) { int c = randomEmpty(rnd, lv); if (c >= 0) lv.boxStart[c] = true; }
                else if (n > 1) {
                    List<Integer> cs = new ArrayList<>();
                    for (int i = 0; i < lv.N; i++) if (lv.boxStart[i]) cs.add(i);
                    lv.boxStart[cs.get(rnd.nextInt(cs.size()))] = false;
                }
                break;
            }
            case 6: { // move the pirate
                int p = -1; for (int i = 0; i < lv.N; i++) if (lv.g[i] == 'P') p = i;
                int to = randomEmpty(rnd, lv);
                if (p >= 0 && to >= 0) { lv.g[p] = '.'; lv.g[to] = 'P'; }
                break;
            }
            case 7: { // move the exit along the border
                int e = -1; for (int i = 0; i < lv.N; i++) if (lv.g[i] == 'E') e = i;
                int x, y;
                int side = rnd.nextInt(4);
                if (side < 2) { x = side == 0 ? 0 : W - 1; y = 1 + rnd.nextInt(H - 2); } else { y = side == 2 ? 0 : H - 1; x = 1 + rnd.nextInt(W - 2); }
                int to = y * W + x;
                int inner = (x == 0 ? to + 1 : x == W - 1 ? to - 1 : y == 0 ? to + W : to - W);
                if (lv.g[inner] == '#') lv.g[inner] = '.';
                if (e >= 0) lv.g[e] = '#';
                lv.g[to] = 'E';
                break;
            }
            case 8: case 9: { // plates: add a plate+gate pair, remove one, move one, relink
                if (st.maxPlates == 0) break;
                List<Integer> plates = new ArrayList<>();
                for (int i = 0; i < lv.N; i++) if (lv.g[i] == '_') plates.add(i);
                int op = rnd.nextInt(4);
                if (op == 0 && plates.size() < st.maxPlates) {
                    int pl = randomEmpty(rnd, lv); if (pl < 0) break;
                    lv.g[pl] = '_';
                    int gt = randomEmpty(rnd, lv); if (gt < 0 || gt == pl) { lv.g[pl] = '.'; break; }
                    lv.plateTo[pl] = gt;
                } else if (op == 1 && !plates.isEmpty()) {
                    int pl = plates.get(rnd.nextInt(plates.size()));
                    lv.g[pl] = '.'; lv.plateTo[pl] = -1;
                } else if (op == 2 && !plates.isEmpty()) {
                    int pl = plates.get(rnd.nextInt(plates.size()));
                    int to = randomEmpty(rnd, lv); if (to < 0) break;
                    lv.g[to] = '_'; lv.plateTo[to] = lv.plateTo[pl]; lv.boxStart[to] = lv.boxStart[pl];
                    lv.g[pl] = '.'; lv.plateTo[pl] = -1; lv.boxStart[pl] = false;
                } else if (!plates.isEmpty()) { // move its gate
                    int pl = plates.get(rnd.nextInt(plates.size()));
                    int gt = randomEmpty(rnd, lv);
                    if (rnd.nextBoolean() && lv.plateTo[pl] >= 0) { // nudge the gate
                        int d = rnd.nextInt(4), n = lv.plateTo[pl] + DX[d] + DY[d] * W;
                        gt = n > 0 && n < lv.N && lv.g[n] == '.' && !lv.boxStart[n] && !lv.isGateCell(n) ? n : -1;
                    }
                    if (gt >= 0) lv.plateTo[pl] = gt;
                }
                break;
            }
            case 10: { // cannons: add (on a wall, facing into the room) with a fuse, remove, move fuse, turn
                if (st.maxCannons == 0) break;
                List<Integer> cannons = new ArrayList<>();
                for (int i = 0; i < lv.N; i++) if (isCannon(lv.g[i])) cannons.add(i);
                int op = rnd.nextInt(4);
                if (op == 0 && cannons.size() < st.maxCannons) {
                    int x = 1 + rnd.nextInt(W - 2), y = 1 + rnd.nextInt(H - 2), i = y * W + x;
                    if (lv.g[i] != '#' && lv.g[i] != '.') break;
                    if (lv.boxStart[i] || lv.isGateCell(i)) break;
                    int d = rnd.nextInt(4);
                    lv.g[i] = "^v<>".charAt(d);
                    int f = randomEmpty(rnd, lv); if (f < 0) { lv.g[i] = '#'; break; }
                    lv.g[f] = 'F'; lv.fuseTo[f] = i;
                } else if (op == 1 && !cannons.isEmpty()) {
                    int c = cannons.get(rnd.nextInt(cannons.size()));
                    lv.g[c] = '#';
                    for (int i = 0; i < lv.N; i++) if (lv.fuseTo[i] == c) { lv.fuseTo[i] = -1; lv.g[i] = '.'; }
                } else if (op == 2 && !cannons.isEmpty()) {
                    int c = cannons.get(rnd.nextInt(cannons.size()));
                    for (int i = 0; i < lv.N; i++) if (lv.fuseTo[i] == c) {
                        int to = randomEmpty(rnd, lv); if (to < 0) break;
                        lv.g[to] = 'F'; lv.fuseTo[to] = c;
                        lv.g[i] = '.'; lv.fuseTo[i] = -1;
                        break;
                    }
                } else if (!cannons.isEmpty()) {
                    int c = cannons.get(rnd.nextInt(cannons.size()));
                    lv.g[c] = "^v<>".charAt(rnd.nextInt(4));
                }
                break;
            }
            default: { // put a crate on a plate or fuse to start, or take it off
                List<Integer> spots = new ArrayList<>();
                for (int i = 0; i < lv.N; i++) if (lv.g[i] == '_') spots.add(i);   // the map format has '=' (crate on a plate) only
                if (spots.isEmpty()) break;
                int s = spots.get(rnd.nextInt(spots.size()));
                if (lv.boxStart[s]) lv.boxStart[s] = false;
                else if (countCrates(lv) < st.maxCrates) lv.boxStart[s] = true;
            }
        }
        // plates and gates must stay on open deck
        for (int i = 0; i < lv.N; i++) if (lv.plateTo[i] >= 0) {
            int t = lv.plateTo[i];
            if (lv.g[i] != '_' || (lv.g[t] != '.' ) || lv.boxStart[t]) { lv.plateTo[i] = -1; if (lv.g[i] == '_') lv.g[i] = '.'; }
        }
        return lv;
    }

    // ---------------- driver ----------------
    public static void main(String[] args) throws Exception {
        String outDir = args[0];
        int threads = Integer.parseInt(args[1]);
        double minutes = Double.parseDouble(args[2]);
        long seed = args.length > 3 ? Long.parseLong(args[3]) : System.nanoTime();
        new File(outDir).mkdirs();
        long end = System.currentTimeMillis() + (long) (minutes * 60_000);
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        AtomicInteger runs = new AtomicInteger();
        for (int t = 0; t < threads; t++) {
            final int tid = t;
            pool.submit(() -> {
                Random rnd = new Random(seed * 31 + tid);
                Style st = STYLES[tid % STYLES.length];
                try (PrintWriter out = new PrintWriter(new FileWriter(new File(outDir, "best-" + tid + ".txt"), true))) {
                    while (System.currentTimeMillis() < end) {
                        int W = 8 + rnd.nextInt(7), H = 6 + rnd.nextInt(5);
                        Lvl cur = randomLevel(rnd, W, H, st);
                        Eval ce = evaluate(cur, 400_000);
                        int tries = 0;
                        while (ce.score < -1e8 && tries++ < 300) { cur = randomLevel(rnd, W, H, st); ce = evaluate(cur, 400_000); }
                        if (ce.score < -1e8) continue;
                        Lvl best = cur; Eval be = ce;
                        int steps = 20000;
                        for (int i = 0; i < steps && System.currentTimeMillis() < end; i++) {
                            double T = 1.2 * Math.pow(0.02 / 1.2, i / (double) steps);
                            Lvl nx = mutate(rnd, cur, st);
                            Eval ne = evaluate(nx, 1_500_000);
                            if (ne.score < -1e8) continue;
                            if (ne.score > be.score) {        // a possible new best: check every piece earns its place
                                ne.unneeded = unneeded(nx, ne.r);
                                ne.score -= 2.5 * ne.unneeded;
                            }
                            double delta = ne.score - ce.score;
                            if (delta >= 0 || rnd.nextDouble() < Math.exp(delta / T)) { cur = nx; ce = ne; }
                            if (ce.score > be.score && ce.unneeded >= 0) { best = cur; be = ce; }
                        }
                        runs.incrementAndGet();
                        if (be.rating >= 12.0 && be.unneeded == 0) {
                            synchronized (Evolve.class) {
                                out.printf("### style=%s score=%.2f rating=%.2f moves=%d pushes=%d states=%d ruin=%.2f %s%n",
                                        st.name, be.score, be.rating, be.r.moves, be.r.pushes, be.r.states, be.r.ruin, be.why);
                                out.print(best.mapString());
                                out.println("links " + best.linksString());
                                out.println("solution " + be.r.solution);
                                out.flush();
                            }
                        }
                    }
                } catch (Throwable ex) { ex.printStackTrace(); }
            });
        }
        pool.shutdown();
        pool.awaitTermination(1, TimeUnit.DAYS);
        System.out.println("climbs finished: " + runs.get());
    }
}
