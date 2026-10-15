package app.rouse.alarm;

import java.util.Random;

/**
 * Native fallback problems (D-032, NATIVE_FALLBACK_PROBLEMS): two-digit × one-digit + two-digit,
 * e.g. "37 × 6 + 48". No 0/1/10 operands. Pure Java so it is unit-testable.
 */
public final class FallbackMath {

    public final int a;
    public final int b;
    public final int c;

    public FallbackMath(int a, int b, int c) {
        this.a = a;
        this.b = b;
        this.c = c;
    }

    public static FallbackMath next(Random rng) {
        int a = 12 + rng.nextInt(38); // 12..49
        int b = 3 + rng.nextInt(7); //   3..9
        int c = 11 + rng.nextInt(89); // 11..99
        return new FallbackMath(a, b, c);
    }

    public int answer() {
        return a * b + c;
    }

    public String text() {
        return a + " × " + b + " + " + c;
    }

    /** Lenient parse of the user's input (whitespace ignored). */
    public boolean check(String input) {
        if (input == null) return false;
        String s = input.trim().replace(" ", "");
        if (s.isEmpty() || s.length() > 6) return false;
        try {
            return Integer.parseInt(s) == answer();
        } catch (NumberFormatException e) {
            return false;
        }
    }
}
