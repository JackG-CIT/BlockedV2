import java.io.*;
import java.util.*;

/** Java port of BlockedV2/solver.py rules (same as fast.py). Breadth-first over
 *  macro positions (free walking collapsed) or exact positions.
 *  Usage: java Solver level.txt [macro|exact] [maxStates]
 *  level.txt: "W H" then one tile per line: type x y dir aX aY (dir/aX/aY may be "-"). */
public class Solver {
    static int W, H, N, WORDS, STRIDE;
    static long[] walls0, boxes0, exits, cannons, gates, special;
    static int[] cdx, cdy;           // cannon direction per cell
    static int[][] plates;           // {cell, target}
    static int[][] fuses;            // {cell, cannon}
    static int[] ctrl;               // gate cell -> deciding plate cell (-1 none)
    static int[][] nb;               // neighbour per dir (U D L R)
    static final int[] DX = {0, 0, -1, 1}, DY = {-1, 1, 0, 0};
    static final char[] DC = {'U', 'D', 'L', 'R'};
    static int player0;

    static boolean get(long[] a, int i) { return (a[i >> 6] >>> (i & 63) & 1L) != 0; }
    static void set(long[] a, int i) { a[i >> 6] |= 1L << (i & 63); }
    static void clr(long[] a, int i) { a[i >> 6] &= ~(1L << (i & 63)); }

    static int cellAt(int c, int dx, int dy) {
        int x = c % W + dx, y = c / W + dy;
        return (x >= 0 && y >= 0 && x < W && y < H) ? y * W + x : -1;
    }

    static void load(String path) throws IOException {
        BufferedReader r = new BufferedReader(new FileReader(path));
        String[] wh = r.readLine().trim().split("\\s+");
        W = Integer.parseInt(wh[0]); H = Integer.parseInt(wh[1]); N = W * H;
        WORDS = (N + 63) / 64; STRIDE = 1 + 2 * WORDS;
        walls0 = new long[WORDS]; boxes0 = new long[WORDS]; exits = new long[WORDS];
        cannons = new long[WORDS]; gates = new long[WORDS]; special = new long[WORDS];
        cdx = new int[N]; cdy = new int[N]; ctrl = new int[N]; Arrays.fill(ctrl, -1);
        List<int[]> pl = new ArrayList<>(), fu = new ArrayList<>();
        List<String[]> lines = new ArrayList<>();
        String line;
        while ((line = r.readLine()) != null) if (!line.isBlank()) lines.add(line.trim().split("\\s+"));
        // tiles are given in board (row) order already
        for (String[] t : lines) {
            String k = t[0]; int x = Integer.parseInt(t[1]), y = Integer.parseInt(t[2]), i = y * W + x;
            switch (k) {
                case "goal": goalWalls.add(i); break;
                case "needbox": needBoxes.add(i); break;
                case "needgone": needGone.add(i); break;
                case "minboxes": minBoxes = x; break;
                case "needfree": needFree.add(i); break;
                case "wall": set(walls0, i); break;
                case "box": set(boxes0, i); break;
                case "player": player0 = i; break;
                case "exit": set(exits, i); break;
                case "cannon": {
                    set(cannons, i);
                    String d = t[3];
                    cdx[i] = d.equals("left") ? -1 : d.equals("right") ? 1 : 0;
                    cdy[i] = d.equals("up") || d.equals("-") ? -1 : d.equals("down") ? 1 : 0;
                    break;
                }
                case "pressureplate": case "fuse": {
                    if (t[4].equals("-") || t[5].equals("-")) break;
                    int ax = Integer.parseInt(t[4]), ay = Integer.parseInt(t[5]);
                    if (ax < 0 || ay < 0 || ax >= W || ay >= H) break;
                    (k.equals("fuse") ? fu : pl).add(new int[]{i, ay * W + ax});
                }
            }
        }
        List<int[]> pl2 = new ArrayList<>();
        for (int[] p : pl) if (!get(cannons, p[1])) { pl2.add(p); set(gates, p[1]); ctrl[p[1]] = p[0]; }
        plates = pl2.toArray(new int[0][]);
        List<int[]> fu2 = new ArrayList<>();
        for (int[] f : fu) if (get(cannons, f[1])) fu2.add(f);
        fuses = fu2.toArray(new int[0][]);
        nb = new int[N][4];
        for (int c = 0; c < N; c++) for (int d = 0; d < 4; d++) nb[c][d] = cellAt(c, DX[d], DY[d]);
        for (int i = 0; i < WORDS; i++) special[i] = exits[i] | gates[i];
        for (int[] p : plates) set(special, p[0]);
        for (int[] f : fuses) set(special, f[0]);
        prepGates();
    }

    // checkPressurePlates + checkFuses (mutates boxes/walls)
    static int[][] gateOrder; static int[][] ring;
    static void prepGates() {
        List<int[]> go = new ArrayList<>();
        for (int[] pt : plates) if (ctrl[pt[1]] == pt[0]) go.add(pt);
        gateOrder = go.toArray(new int[0][]);
        ring = new int[N][];
        for (int[] pt : gateOrder) {
            int t = pt[1], gx = t % W, gy = t / W;
            List<Integer> o = new ArrayList<>();
            for (int r = 1; r < Math.max(W, H); r++)
                for (int y = gy - r; y <= gy + r; y++)
                    for (int x = gx + r; x >= gx - r; x--)
                        if (Math.max(Math.abs(x - gx), Math.abs(y - gy)) == r && x >= 0 && y >= 0 && x < W && y < H)
                            o.add(y * W + x);
            ring[t] = o.stream().mapToInt(Integer::intValue).toArray();
        }
    }

    /** Returns false if a gate shut on the pirate. */
    /** Open or shut every gate (with the squeeze). False if a gate crushed the pirate. */
    static boolean settlePlates(int p, long[] boxes, long[] walls) {
        for (int pass = 0; pass < 10; pass++) {
            boolean squeezed = false;
            for (int[] pt : gateOrder) {
                int plate = pt[0], t = pt[1];
                if (plate == p || get(boxes, plate)) clr(walls, t);
                else if (!get(walls, t)) {
                    if (t == p) return false;
                    if (get(boxes, t)) {
                        clr(boxes, t);
                        for (int c : ring[t])
                            if (c != p && !get(walls, c) && !get(boxes, c) && !get(cannons, c)) { set(boxes, c); break; }
                        squeezed = true;
                    }
                    set(walls, t);
                }
            }
            if (!squeezed) break;
        }
        return true;
    }

    /** Plates, then fuses; shot crates fly a tile at a time and the plates react after every tile. */
    static boolean checks(int p, long[] boxes, long[] walls) {
        if (!settlePlates(p, boxes, walls)) return false;
        for (int[] f : fuses) {
            if (!(f[0] == p || get(boxes, f[0]))) continue;
            int c = f[1], dx = cdx[c], dy = cdy[c];
            int cur = cellAt(c, dx, dy);
            if (cur < 0 || !get(boxes, cur)) continue;
            while (true) {
                int n = cellAt(cur, dx, dy);
                if (n == p) return false;   // the shot flattens the pirate
                if (n < 0 || get(boxes, n) || get(walls, n)) {
                    if (n >= 0 && get(walls, n) && !get(gates, n)) clr(walls, n);
                    clr(boxes, cur);
                    if (n >= 0 && get(boxes, n)) clr(boxes, n);
                    if (!settlePlates(p, boxes, walls)) return false;
                    break;
                }
                clr(boxes, cur); set(boxes, n); cur = n;
                if (!settlePlates(p, boxes, walls)) return false;
                if (!get(boxes, cur)) break;   // squeezed away by a shutting gate
            }
        }
        return true;
    }

    static boolean gateOpenAfter(int g, int p, long[] boxes) {
        int pl = ctrl[g];
        return pl == p || get(boxes, pl);
    }

    // result arrays (reused)
    static long[] rb, rw;
    static int rp;

    /** Move from (p, boxes, walls) in dir d. Returns false if blocked; result in rp/rb/rw. */
    static boolean move(int p, long[] boxes, long[] walls, int d) {
        int n = nb[p][d];
        if (n < 0 || get(walls, n) || get(cannons, n)) return false;
        rb = boxes.clone(); rw = walls.clone();
        int b = -1;
        if (get(boxes, n)) {
            b = nb[n][d];
            if (b < 0 || get(walls, b) || get(boxes, b) || get(cannons, b)) return false;
            clr(rb, n); set(rb, b);
        }
        if (get(gates, n) && !gateOpenAfter(n, n, rb)) return false;
        if (b >= 0 && get(gates, b) && !gateOpenAfter(b, n, rb)) return false;
        if (!checks(n, rb, rw)) return false;
        rp = n;
        return true;
    }

    // ---- state storage ----
    static long[] arena; static int count = 0, cap;
    static int[] table; static int mask;
    static int[] parent, info;   // info = src*4+dir (macro) or dir (exact)

    static long hash(long[] a, int off) {
        long h = 0x9E3779B97F4A7C15L;
        for (int i = 0; i < STRIDE; i++) { h ^= a[off + i]; h *= 0xBF58476D1CE4E5B9L; h ^= h >>> 31; }
        return h;
    }

    static int[] stamp; static int stampNo = 0; static int[] queue;
    static int[] depth; static long[] plateMask;
    static List<Integer> goalWalls = new ArrayList<>();
    static List<Integer> needBoxes = new ArrayList<>(), needGone = new ArrayList<>(), needFree = new ArrayList<>();
    static int minBoxes = 0;
    static int boxCount(long[] b) { int n = 0; for (long w : b) n += Long.bitCount(w); return n; }
    /** Win: reached a chest, or (if needbox/needgone lines were given) every listed
     *  square holds a crate and every listed wall has been blasted. */
    static boolean won(int p, long[] boxes, long[] walls) {
        if (needBoxes.isEmpty() && needGone.isEmpty() && needFree.isEmpty()) return get(exits, p);
        for (int c : needFree) if (get(boxes, c)) return false;
        for (int c : needBoxes) if (!get(boxes, c)) return false;
        for (int c : needGone) if (get(walls, c)) return false;
        return true;
    }
    static long[] curWalls;

    /** Plates nobody is standing on. */
    static int h(int p, long[] boxes) {
        int held = 0;
        for (int i = 0; i < WORDS; i++) held += Long.bitCount(boxes[i] & plateMask[i]);
        if (get(plateMask, p)) held++;
        int standing = 0;
        for (int g : goalWalls) if (get(curWalls, g)) standing++;
        int missing = 0;
        for (int c : needBoxes) if (!get(boxes, c)) missing++;
        return plates.length - held + 3 * standing + 3 * missing;
    }

    /** Canonical player cell: itself if on a special square, else min cell of its walkable region. */
    static int canon(int p, long[] boxes, long[] walls, boolean macro) {
        if (!macro || get(special, p)) return p;
        stampNo++;
        int qh = 0, qt = 0, best = p;
        queue[qt++] = p; stamp[p] = stampNo;
        while (qh < qt) {
            int c = queue[qh++];
            if (c < best) best = c;
            for (int d = 0; d < 4; d++) {
                int n = nb[c][d];
                if (n < 0 || stamp[n] == stampNo || !free(n, boxes, walls)) continue;
                stamp[n] = stampNo; queue[qt++] = n;
            }
        }
        return best;
    }

    static boolean free(int n, long[] boxes, long[] walls) {
        return !get(walls, n) && !get(boxes, n) && !get(cannons, n) && !get(special, n);
    }

    /** Adds a state; returns its index, or -1 if already present, or -2 if full. */
    static long[] tmp;
    static int add(int p, long[] boxes, long[] walls, int par, int inf) {
        tmp[0] = p;
        System.arraycopy(boxes, 0, tmp, 1, WORDS);
        System.arraycopy(walls, 0, tmp, 1 + WORDS, WORDS);
        int slot = (int) (hash(tmp, 0) & mask);
        while (table[slot] != 0) {
            int idx = table[slot] - 1, off = idx * STRIDE;
            boolean eq = true;
            for (int i = 0; i < STRIDE; i++) if (arena[off + i] != tmp[i]) { eq = false; break; }
            if (eq) return -1;
            slot = (slot + 1) & mask;
        }
        if (count >= cap) return -2;
        System.arraycopy(tmp, 0, arena, count * STRIDE, STRIDE);
        parent[count] = par; info[count] = inf;
        table[slot] = count + 1;
        return count++;
    }

    public static void main(String[] args) throws IOException {
        load(args[0]);
        String mode = args.length < 2 ? "macro" : args[1];
        boolean macro = !mode.equals("exact");
        boolean greedy = mode.startsWith("greedy");
        int weight = greedy && mode.length() > 6 ? Integer.parseInt(mode.substring(6)) : 3;
        cap = args.length > 2 ? Integer.parseInt(args[2]) : 20_000_000;
        long need = (long) cap * STRIDE;
        if (need > Integer.MAX_VALUE - 8) { cap = (Integer.MAX_VALUE - 8) / STRIDE; need = (long) cap * STRIDE; }
        arena = new long[(int) need];
        int tsize = Integer.highestOneBit(Math.max(16, cap)) << 1; mask = tsize - 1;
        table = new int[tsize]; parent = new int[cap]; info = new int[cap];
        depth = new int[cap];
        for (int[] pt : plates) set(plateMask = plateMask == null ? new long[WORDS] : plateMask, pt[0]);
        if (plateMask == null) plateMask = new long[WORDS];
        stamp = new int[N]; queue = new int[N]; tmp = new long[STRIDE];

        long[] b0 = boxes0.clone(), w0 = walls0.clone();
        checks(player0, b0, w0);
        int startP = player0;
        add(canon(startP, b0, w0, macro), b0, w0, -1, 0);
        long[] boxes = new long[WORDS], walls = new long[WORDS];
        int win = -1; boolean full = false;
        if (won(startP, b0, w0)) win = 0;
        long t0 = System.currentTimeMillis();
        PriorityQueue<long[]> pq = new PriorityQueue<>((a, b) -> Long.compare(a[0], b[0]));
        if (greedy) pq.add(new long[]{0, 0});
        int bfsHead = 0;
        outer:
        while (win < 0) {
            int head;
            if (greedy) { if (pq.isEmpty()) break; head = (int) pq.poll()[1]; }
            else { if (bfsHead >= count) break; head = bfsHead++; }
            int off = head * STRIDE, p = (int) arena[off];
            System.arraycopy(arena, off + 1, boxes, 0, WORDS);
            System.arraycopy(arena, off + 1 + WORDS, walls, 0, WORDS);
            // sources: the player square, or every square of the walkable region
            int[] srcs;
            int ns;
            if (!macro || get(special, p)) { srcs = new int[]{p}; ns = 1; }
            else {
                stampNo++;
                int qh = 0, qt = 0;
                queue[qt++] = p; stamp[p] = stampNo;
                while (qh < qt) {
                    int c = queue[qh++];
                    for (int d = 0; d < 4; d++) {
                        int n = nb[c][d];
                        if (n < 0 || stamp[n] == stampNo || !free(n, boxes, walls)) continue;
                        stamp[n] = stampNo; queue[qt++] = n;
                    }
                }
                srcs = Arrays.copyOf(queue, qt); ns = qt;
            }
            for (int si = 0; si < ns; si++) {
                int src = srcs[si];
                for (int d = 0; d < 4; d++) {
                    if (macro && ns > 1) { int n = nb[src][d]; if (n >= 0 && free(n, boxes, walls)) continue; }
                    if (!move(src, boxes, walls, d)) continue;
                    if (minBoxes > 0 && boxCount(rb) < minBoxes) continue;
                    if (rp == src && Arrays.equals(rb, boxes) && Arrays.equals(rw, walls)) continue;
                    int k = add(canon(rp, rb, rw, macro), rb, rw, head, src * 4 + d);
                    if (k == -2) { full = true; break outer; }
                    if (k >= 0 && won(rp, rb, rw)) { win = k; break outer; }
                    if (k >= 0) {
                        depth[k] = depth[head] + 1;
                        if (greedy) { curWalls = rw; pq.add(new long[]{depth[k] + (long) weight * h(rp, rb), k}); }
                    }
                }
            }
        }
        long ms = System.currentTimeMillis() - t0;
        if (win < 0) {
            System.out.println("RESULT " + (full ? "TRUNCATED" : "UNSOLVABLE") + " states=" + count + " ms=" + ms);
            return;
        }
        StringBuilder sb = new StringBuilder();
        List<int[]> steps = new ArrayList<>();
        for (int k = win; parent[k] >= 0; k = parent[k]) steps.add(new int[]{info[k] / 4, info[k] % 4});
        Collections.reverse(steps);
        for (int[] s : steps) sb.append(s[0]).append(':').append(DC[s[1]]).append(' ');
        System.out.println("RESULT SOLVED states=" + count + " ms=" + ms + " steps=" + steps.size());
        System.out.println("STEPS " + sb.toString().trim());
    }
}
