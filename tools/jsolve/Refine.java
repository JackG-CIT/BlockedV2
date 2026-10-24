import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;

/**
 * Keeps climbing the best levels the evolver found: lower temperature, more
 * steps, and bigger puzzles allowed (hints follow each level's stored route,
 * so a big state space is fine). Same rules and scoring as Evolve.
 *
 *   java -Xmx16g -cp jsolve Refine <outDir> <threads> <minutes> <seedFile>...
 */
public class Refine {
    static Evolve.Lvl parse(List<String> rows, String links) {
        Evolve.Lvl lv = new Evolve.Lvl();
        lv.H = rows.size(); lv.W = rows.get(0).length(); lv.N = lv.W * lv.H; lv.WORDS = (lv.N + 63) / 64;
        lv.g = new char[lv.N]; lv.boxStart = new boolean[lv.N]; lv.plateTo = new int[lv.N]; lv.fuseTo = new int[lv.N];
        Arrays.fill(lv.plateTo, -1); Arrays.fill(lv.fuseTo, -1);
        for (int y = 0; y < lv.H; y++) for (int x = 0; x < lv.W; x++) {
            char c = rows.get(y).charAt(x); int i = y * lv.W + x;
            if (c == 'D') c = '.';
            if (c == '=') { c = '_'; lv.boxStart[i] = true; }
            if (c == 'B') { c = '.'; lv.boxStart[i] = true; }
            lv.g[i] = c;
        }
        for (String part : links.trim().split(" +")) {
            if (!part.contains("->")) continue;
            String[] ab = part.split("->"), a = ab[0].split(","), b = ab[1].split(",");
            int from = Integer.parseInt(a[1]) * lv.W + Integer.parseInt(a[0]);
            int to = Integer.parseInt(b[1]) * lv.W + Integer.parseInt(b[0]);
            if (lv.g[from] == '_') lv.plateTo[from] = to; else if (lv.g[from] == 'F') lv.fuseTo[from] = to;
        }
        return lv;
    }

    record Seed(Evolve.Lvl lv, Evolve.Style st) {}

    static List<Seed> readSeeds(String path) throws IOException {
        List<Seed> out = new ArrayList<>();
        String text = Files.readString(Path.of(path));
        for (String block : text.split("### ")) {
            if (block.isBlank()) continue;
            String[] lines = block.replace("\r", "").split("\n");   // Windows line endings
            String style = lines[0].replaceAll(".*style=([a-z]+).*", "$1");
            List<String> rows = new ArrayList<>();
            String links = "";
            for (int k = 1; k < lines.length; k++) {
                String l = lines[k].trim();
                if (l.startsWith("links")) links = l.substring(5);
                else if (l.startsWith("solution") || l.isEmpty()) continue;
                else rows.add(l);
            }
            Evolve.Style st = Evolve.STYLES[0];
            for (Evolve.Style s : Evolve.STYLES) if (s.name.equals(style)) st = s;
            out.add(new Seed(parse(rows, links), st));
        }
        return out;
    }

    public static void main(String[] args) throws Exception {
        String outDir = args[0];
        int threads = Integer.parseInt(args[1]);
        double minutes = Double.parseDouble(args[2]);
        List<Seed> seeds = new ArrayList<>();
        for (int k = 3; k < args.length; k++) seeds.addAll(readSeeds(args[k]));
        System.out.println("seeds: " + seeds.size());
        Evolve.BIG_STATES = 2_000_000;
        new File(outDir).mkdirs();
        long end = System.currentTimeMillis() + (long) (minutes * 60_000);
        ExecutorService pool = Executors.newFixedThreadPool(threads);
        for (int t = 0; t < threads; t++) {
            final int tid = t;
            pool.submit(() -> {
                Random rnd = new Random(7919L * tid + 17);
                try (PrintWriter out = new PrintWriter(new FileWriter(new File(outDir, "best-" + tid + ".txt"), true))) {
                    int round = 0;
                    while (System.currentTimeMillis() < end) {
                        Seed sd = seeds.get((tid + round * threads) % seeds.size());
                        round++;
                        Evolve.Lvl cur = sd.lv().copy();
                        Evolve.Eval ce = Evolve.evaluate(cur, 1_500_000);
                        if (ce.score < -1e8) continue;
                        ce.unneeded = Evolve.unneeded(cur, ce.r);
                        ce.score -= 2.5 * ce.unneeded;
                        Evolve.Lvl best = cur; Evolve.Eval be = ce;
                        double start = be.rating;
                        int steps = 12000;
                        for (int i = 0; i < steps && System.currentTimeMillis() < end; i++) {
                            double T = 0.5 * Math.pow(0.01 / 0.5, i / (double) steps);
                            Evolve.Lvl nx = Evolve.mutate(rnd, cur, sd.st());
                            Evolve.Eval ne = Evolve.evaluate(nx, 1_500_000);
                            if (ne.score < -1e8) continue;
                            if (ne.score > be.score) {
                                ne.unneeded = Evolve.unneeded(nx, ne.r);
                                ne.score -= 2.5 * ne.unneeded;
                            }
                            double delta = ne.score - ce.score;
                            if (delta >= 0 || rnd.nextDouble() < Math.exp(delta / T)) { cur = nx; ce = ne; }
                            if (ce.score > be.score && ce.unneeded >= 0) { best = cur; be = ce; }
                        }
                        if (be.unneeded == 0 && be.rating > start + 0.2) {
                            synchronized (Refine.class) {
                                out.printf("### style=%s score=%.2f rating=%.2f moves=%d pushes=%d states=%d ruin=%.2f from=%.2f %s%n",
                                        sd.st().name, be.score, be.rating, be.r.moves, be.r.pushes, be.r.states, be.r.ruin, start, be.why);
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
        System.out.println("done");
    }
}
