import {
  DISPLAY_NAME_MAX,
  LEAGUE_TYPE_INFO,
  type LeagueType,
  MINIMUM_AGE,
  updateProfileSchema,
} from "@picks/shared";
import { useLocalSearchParams, usePathname } from "expo-router";
import { type ComponentRef, useRef, useState } from "react";
import { ScrollView, Text, type TextInput, useWindowDimensions, View } from "react-native";
import { AppLink } from "../components/AppLink";
import { Form } from "../components/Form";
import { Icon } from "../components/Icon";
import { PreferenceToggle } from "../components/PreferenceToggle";
import { hoverFill } from "../components/pressState";
import { Splash } from "../components/Splash";
import { TeamLogo } from "../components/TeamLogo";
import {
  Badge,
  Body,
  Button,
  Card,
  colors,
  ErrorMessage,
  Field,
  fonts,
  Notice,
  Screen,
  styles,
  Title,
} from "../components/ui";
import { getSupabase, request } from "../lib/api";
import { useAuth } from "../lib/auth";
import { authMessage } from "../lib/authErrors";
import { appLink } from "../lib/config";
import { useDesktopFocus } from "../lib/desktopFocus";
import { nextPath, withNext } from "../lib/links";
import { useShowsSignInForm } from "../lib/signInForm";

type Mode = "signin" | "signup" | "reset" | "name";

/**
 * The name step's draft, in memory only: it survives the player reading the Terms or the Privacy policy and
 * coming Back (the step unmounts meanwhile). It belongs to one account and is gone once the name is saved.
 */
let nameDraft: { userId: string; name: string; agreed: boolean } | undefined;

export function AuthScreen({ nameOnly = false }: { nameOnly?: boolean }) {
  const auth = useAuth();
  const path = usePathname();
  const params = useLocalSearchParams<{ next?: string }>();
  const landing = path === "/" && !nameOnly;
  // The header leaves out its own "Sign in" while this form stands in for the page that was asked for.
  useShowsSignInForm(!nameOnly && !landing);
  // An invite link opened signed out.
  const joining = path.startsWith("/join/");
  // Where a confirmed sign-up returns to: the page this form stands in for, or /login's own `next`.
  const pending = nextPath(path === "/login" ? params.next : path);
  const userId = auth.session?.user.id;
  const draft = nameOnly && userId && nameDraft?.userId === userId ? nameDraft : undefined;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setNameState] = useState(draft?.name ?? "");
  const [agreed, setAgreedState] = useState(draft?.agreed ?? false);
  const [forgot, setForgot] = useState(path === "/reset-password");
  const [busy, setBusy] = useState<Mode>();
  // The password field asks password managers for a new password once the player chose Create account.
  const [creating, setCreating] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [sent, setSent] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const emailRef = useRef<ComponentRef<typeof TextInput>>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const nameRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [formY, setFormY] = useState(0);
  const [cardY, setCardY] = useState(0);
  const { width } = useWindowDimensions();
  useDesktopFocus(nameOnly ? nameRef : emailRef, !landing);
  const keepDraft = (patch: Partial<{ name: string; agreed: boolean }>) => {
    if (!userId) return;
    const base = nameDraft?.userId === userId ? nameDraft : { userId, name: "", agreed: false };
    nameDraft = { ...base, ...patch };
  };
  const setName = (value: string) => {
    setNameState(value);
    keepDraft({ name: value });
  };
  const setAgreed = (value: boolean) => {
    setAgreedState(value);
    keepDraft({ agreed: value });
  };
  async function submit(mode: Mode) {
    if (lock.current) return;
    setError(undefined);
    setStatus(undefined);
    if (mode === "signup") setCreating(true);
    if (mode === "name" && !agreed) return setError("Agree to the Terms of use to continue.");
    if (mode !== "name" && !email.trim()) return setError("Enter your email.");
    if ((mode === "signin" || mode === "signup") && password.length < 6)
      return setError("Use a password of at least six characters.");
    lock.current = true;
    setBusy(mode);
    try {
      if (mode === "name") {
        const parsed = updateProfileSchema.safeParse({ displayName: name, acceptTerms: true });
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Enter a name");
        await request("/me", { method: "PUT", body: parsed.data });
        nameDraft = undefined;
        await auth.refreshProfile();
        return;
      }
      const sb = await getSupabase();
      if (mode === "reset") {
        const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: appLink("/reset-password"),
        });
        if (error) throw error;
        setSent(true);
        setStatus(`If there's an account for ${email.trim()}, a reset link is on its way. Check your inbox.`);
      } else if (mode === "signup") {
        const { data, error } = await sb.auth.signUp({
          email: email.trim(),
          password,
          // The confirmation link comes back to the page this form stands in for (an invite, say).
          options: { emailRedirectTo: withNext(appLink("/auth/callback"), pending) },
        });
        if (error) throw error;
        if (!data.session) setStatus("Check your email to confirm your account, then sign in.");
      } else {
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
      }
    } catch (error) {
      setError(authMessage(error));
    } finally {
      setBusy(undefined);
      lock.current = false;
    }
  }
  const primary: Mode = nameOnly ? "name" : forgot ? "reset" : "signin";
  const fields = nameOnly ? (
    <>
      <Field
        ref={nameRef}
        label="Display name"
        value={name}
        onChangeText={setName}
        autoComplete="nickname"
        autoCapitalize="words"
        maxLength={DISPLAY_NAME_MAX}
        editable={!busy}
        onSubmit={() => void submit("name")}
      />
      <PreferenceToggle
        label={`I'm ${MINIMUM_AGE} or older and I agree to the Terms of use`}
        description="No harassment, hate, sexual content, threats or spam on the message board."
        checked={agreed}
        disabled={!!busy}
        onChange={setAgreed}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 20 }}>
        <Button title="Read the Terms of use" variant="link" style={{ paddingHorizontal: 0 }} href="/terms" />
        <Button
          title="Read the Privacy policy"
          variant="link"
          style={{ paddingHorizontal: 0 }}
          href="/privacy"
        />
      </View>
    </>
  ) : (
    <>
      {forgot && (
        <Body muted>
          Enter the email you signed up with and we'll send you a link to choose a new password.
        </Body>
      )}
      <Field
        ref={emailRef}
        label="Email"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="username"
        editable={!busy}
        enterKeyHint={forgot ? "send" : "next"}
        onSubmit={() => (forgot ? void submit("reset") : passwordRef.current?.focus())}
      />
      {!forgot && (
        <View style={{ gap: 4 }}>
          <Field
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={creating ? "new-password" : "current-password"}
            textContentType={creating ? "newPassword" : "password"}
            editable={!busy}
            enterKeyHint="go"
            onSubmit={() => void submit("signin")}
          />
          <Button
            title="Forgot password?"
            variant="link"
            style={{ alignSelf: "flex-end", paddingHorizontal: 0 }}
            disabled={!!busy}
            onPress={() => {
              setForgot(true);
              setError(undefined);
              setStatus(undefined);
            }}
          />
        </View>
      )}
    </>
  );
  const form = (
    <Card>
      {landing && (
        <Title level={3} style={{ fontSize: 24, lineHeight: 28 }}>
          Welcome to POW Pick'em
        </Title>
      )}
      {nameOnly ? fields : <Form>{fields}</Form>}
      <ErrorMessage message={error ?? (sent ? undefined : auth.linkError)} />
      <Notice message={status} />
      <View style={{ gap: 8 }}>
        <Button
          title={
            busy === "name"
              ? "Saving…"
              : nameOnly
                ? "Continue"
                : forgot
                  ? busy === "reset"
                    ? "Sending…"
                    : sent
                      ? "Send again"
                      : "Send reset link"
                  : busy === "signin"
                    ? "Signing in…"
                    : "Sign in"
          }
          busy={busy === primary}
          // Ticking the box is what lets the name step continue, so it stays switched off until then.
          disabled={(!!busy && busy !== primary) || (nameOnly && !agreed)}
          onPress={() => void submit(primary)}
        />
        {!nameOnly && (
          <Button
            title={forgot ? "Back to sign in" : busy === "signup" ? "Creating account…" : "Create account"}
            variant={forgot ? "ghost" : "outline"}
            busy={busy === "signup"}
            disabled={!!busy && busy !== "signup"}
            onPress={() => {
              if (forgot) {
                setForgot(false);
                setError(undefined);
                setStatus(undefined);
              } else void submit("signup");
            }}
          />
        )}
      </View>
      {!nameOnly && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 20, justifyContent: "center" }}>
          <Button title="Terms of use" variant="link" style={{ paddingHorizontal: 0 }} href="/terms" />
          <Button title="Privacy policy" variant="link" style={{ paddingHorizontal: 0 }} href="/privacy" />
        </View>
      )}
    </Card>
  );
  if (!landing)
    return (
      <Screen narrow contentStyle={{ maxWidth: 416, paddingTop: 44 }}>
        <View style={{ gap: 8 }}>
          <Title>
            {nameOnly
              ? "What should we call you?"
              : forgot
                ? "Reset your password"
                : joining
                  ? "Join the league"
                  : "Welcome back"}
          </Title>
          {nameOnly ? (
            <Body muted>This is the name your league sees on the leaderboard.</Body>
          ) : (
            !forgot && (
              <Body muted>
                {joining
                  ? "Sign in or create an account to join the league."
                  : "Pick pro football winners against the spread with your league."}
              </Body>
            )
          )}
        </View>
        {form}
      </Screen>
    );
  const wide = width >= 768;
  // Brings the whole sign-up card into view (not just its section's heading), then puts the cursor in Email.
  const getStarted = () => {
    scroll.current?.scrollTo({ y: Math.max(0, formY + cardY - 16), animated: true });
    setTimeout(() => emailRef.current?.focus(), 400);
  };
  return (
    <ScrollView
      ref={scroll}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[styles.content, { gap: 40, paddingTop: 36, paddingBottom: 64 }]}
    >
      <View
        style={{ flexDirection: wide ? "row" : "column", alignItems: wide ? "center" : "stretch", gap: 32 }}
      >
        <View style={{ gap: 20, flex: 1 }}>
          <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.primary }}>
            Your league. Every week. All season.
          </Text>
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={{
              fontFamily: fonts.displayExtraBold,
              fontSize: wide ? 72 : 60,
              lineHeight: wide ? 65 : 54,
              color: colors.foreground,
              textTransform: "uppercase",
            }}
          >
            Beat the spread.{"\n"}
            <Text style={{ color: colors.primary }}>Own the week.</Text>
          </Text>
          <Body muted style={{ fontSize: 18, lineHeight: 28 }}>
            A pro football pick'em built for your crew. Pick every game against the spread, call your Pick of
            the Week, and chase the top spot in your league.
          </Body>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Button title="Get started" icon="chevron-right" onPress={getStarted} />
            <Button title="How to play" variant="outline" href="/how-to-play" />
          </View>
          <Body muted style={{ fontSize: 14, lineHeight: 20 }}>
            Have an invite? Open your commissioner's link to join their league.
          </Body>
        </View>
        <View style={{ flex: wide ? 1 : undefined }}>
          <ExamplePick />
        </View>
      </View>
      <View style={{ flexDirection: wide ? "row" : "column", gap: 16 }}>
        {[
          {
            icon: "football" as const,
            title: "Pick the slate",
            detail: "Choose a side in every game. The spread is the score to beat.",
          },
          {
            icon: "star" as const,
            title: "Call your POW",
            detail: "Back one pick for 5 extra points if it wins.",
          },
          {
            icon: "trophy" as const,
            title: "Chase first place",
            detail: "See everyone's picks and the standings once the week is final.",
          },
        ].map((item) => (
          <Card key={item.title} style={{ flex: wide ? 1 : undefined, gap: 8 }}>
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: colors.primaryTint,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon name={item.icon} color={colors.primary} size={20} />
            </View>
            <Title level={3} style={{ fontSize: 20, lineHeight: 24 }}>
              {item.title}
            </Title>
            <Body muted style={{ fontSize: 14, lineHeight: 20 }}>
              {item.detail}
            </Body>
          </Card>
        ))}
      </View>
      <MoreWays wide={wide} />
      <View
        onLayout={(event) => setFormY(event.nativeEvent.layout.y)}
        style={{ flexDirection: wide ? "row" : "column", gap: 24 }}
      >
        <View style={{ flex: 1, gap: 16 }}>
          <Title level={2}>Your next game starts here</Title>
          <Body muted>
            Sign in to your leagues or create an account to get going. Set your display name, then follow an
            invite link or start a league of your own.
          </Body>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Icon name="lock" color={colors.primary} />
            <Body muted style={{ fontSize: 14, lineHeight: 20, flex: 1 }}>
              Each game locks at kickoff. Change your picks and your POW any time before then.
            </Body>
          </View>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <Icon name="trophy" color={colors.primary} />
            <Body muted style={{ fontSize: 14, lineHeight: 20, flex: 1 }}>
              Running the league? Let it run itself from the pro football schedule, or run each week by hand.
              The guide covers both.
            </Body>
          </View>
          <Button
            title="Read the rules & app guide"
            variant="link"
            style={{ alignSelf: "flex-start", paddingHorizontal: 0 }}
            href="/how-to-play"
          />
        </View>
        <View onLayout={(event) => setCardY(event.nativeEvent.layout.y)} style={{ flex: 1 }}>
          {form}
        </View>
      </View>
    </ScrollView>
  );
}
/** The other games a league can play: a quieter strip under the weekly pitch, each linking to its rules. */
const OTHER_GAMES: { type: Exclude<LeagueType, "weekly">; pitch: string }[] = [
  { type: "playoff", pitch: "Pick'em through the playoffs, with one champion after the Super Bowl." },
  { type: "squares", pitch: "A 10 by 10 board on one game. Quarter scores pick the winning squares." },
  { type: "survivor", pitch: "One team a week, never the same one twice. Last player standing wins." },
];

function MoreWays({ wide }: { wide: boolean }) {
  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 4 }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.primary }}>
          More ways to play
        </Text>
        <Body muted style={{ fontSize: 14, lineHeight: 20 }}>
          A league can play one of these instead, with the same invites, messages and reminders.
        </Body>
      </View>
      <View style={{ flexDirection: wide ? "row" : "column", gap: 8 }}>
        {OTHER_GAMES.map(({ type, pitch }) => (
          <AppLink
            key={type}
            href={`/how-to-play?section=${type}`}
            accessibilityLabel={`How ${LEAGUE_TYPE_INFO[type].name} works`}
            style={(state) => ({
              flex: wide ? 1 : undefined,
              minHeight: 44,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              padding: 12,
              borderRadius: 12,
              backgroundColor: hoverFill(state, colors.card),
            })}
          >
            <Icon name={LEAGUE_TYPE_INFO[type].icon} color={colors.mutedForeground} size={20} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.foreground }}>
                {LEAGUE_TYPE_INFO[type].name}
              </Text>
              <Body muted style={{ fontSize: 13, lineHeight: 18 }}>
                {pitch}
              </Body>
            </View>
            <Icon name="chevron-right" color={colors.mutedForeground} size={16} />
          </AppLink>
        ))}
      </View>
    </View>
  );
}

function ExamplePick() {
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Body muted style={{ fontSize: 14 }}>
          Monday night · 8:15 PM
        </Body>
        <View style={{ flexDirection: "row", gap: 6 }}>
          <Badge tone="outline">Example</Badge>
          <Badge>3 pts</Badge>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {[
          { team: "BUF", name: "Bills", spread: "−3.5", picked: true },
          { team: "MIA", name: "Dolphins", spread: "+3.5 · home", picked: false },
        ].map((team) => (
          <View
            key={team.team}
            style={{
              position: "relative",
              flex: 1,
              minHeight: 104,
              borderRadius: 12,
              backgroundColor: team.picked ? colors.primary : colors.raised,
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
            }}
          >
            {team.picked && (
              <View style={{ position: "absolute", right: 6, top: 6 }}>
                <Icon name="check" size={15} color={colors.primaryForeground} />
              </View>
            )}
            <TeamLogo team={team.team} size={36} />
            <Text
              style={{
                fontFamily: fonts.displayBold,
                fontSize: 20,
                color: team.picked ? colors.primaryForeground : colors.foreground,
                textTransform: "uppercase",
              }}
            >
              {team.name}
            </Text>
            <Text
              style={{
                fontFamily: fonts.medium,
                fontSize: 14,
                color: team.picked ? colors.primaryForeground : colors.mutedForeground,
              }}
            >
              {team.spread}
            </Text>
          </View>
        ))}
        <View
          style={{
            width: 56,
            borderRadius: 12,
            backgroundColor: colors.pow,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontFamily: fonts.displayExtraBold, fontSize: 16, color: colors.powForeground }}>
            POW
          </Text>
        </View>
      </View>
      <Body muted style={{ fontSize: 14, lineHeight: 20 }}>
        Buffalo at Miami: the Bills need to win by 4 or more. Make it your POW and a win is worth{" "}
        <Text style={{ color: colors.win, fontFamily: fonts.semibold }}>8 points</Text>.
      </Body>
    </Card>
  );
}
export function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  if (auth.loading) return <Splash name={auth.me?.displayName ?? undefined} />;
  if (auth.error)
    return (
      <Screen narrow>
        <Title>Can't open POW Pick'em</Title>
        <ErrorMessage message={auth.error} onRetry={auth.retry} />
        {auth.session && <Button title="Sign out" variant="outline" onPress={() => void auth.signOut()} />}
      </Screen>
    );
  if (!auth.session) return <AuthScreen />;
  if (!auth.me?.displayName) return <AuthScreen nameOnly />;
  return children;
}
