import {
  DISPLAY_NAME_MAX,
  LEAGUE_TYPE_INFO,
  type LeagueType,
  MINIMUM_AGE,
  type Side,
  updateProfileSchema,
} from "@picks/shared";
import { useLocalSearchParams, usePathname } from "expo-router";
import { type ComponentRef, useRef, useState } from "react";
import {
  Animated,
  type GestureResponderEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  type TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { AppLink, openPath } from "../components/AppLink";
import { Avatar } from "../components/Avatar";
import { Form } from "../components/Form";
import { Icon } from "../components/Icon";
import { PreferenceToggle } from "../components/PreferenceToggle";
import { hoverFill, pressTile } from "../components/pressState";
import { Splash } from "../components/Splash";
import { TeamLogo } from "../components/TeamLogo";
import { corner, elevation, layout, radius, space, tabular, type, widths } from "../components/theme";
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
import { AUTH_MESSAGES, authMessage } from "../lib/authErrors";
import { appLink } from "../lib/config";
import { useDesktopFocus } from "../lib/desktopFocus";
import { haptics } from "../lib/haptics";
import {
  EXAMPLE_GAME,
  exampleCaption,
  exampleLine,
  HERO_GAP,
  HERO_SHARE,
  heroHeadline,
  landingLayout,
} from "../lib/landing";
import { nextPath, withNext } from "../lib/links";
import { usePop, useReducedMotion, webTransition } from "../lib/motion";
import { useShowsSignInForm } from "../lib/signInForm";

/** What the form is doing: signing in, creating an account, sending a reset link, or saving the name. */
type Action = "signin" | "signup" | "reset" | "name";
/** The card's two modes: sign in to an account, or create one. */
type FormMode = "signin" | "signup";

/**
 * The name step's draft, in memory only: it survives the player reading the Terms or the Privacy policy and
 * coming Back (the step unmounts meanwhile). It belongs to one account and is gone once the name is saved.
 */
let nameDraft: { userId: string; name: string; agreed: boolean } | undefined;

export function AuthScreen({ nameOnly = false }: { nameOnly?: boolean }) {
  const auth = useAuth();
  const path = usePathname();
  const params = useLocalSearchParams<{ next?: string; mode?: string }>();
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
  const [busy, setBusy] = useState<Action>();
  // The home page and an invite are for newcomers; anywhere else (a page that needs an account, /login) the
  // visitor most likely has one. `?mode=signup` asks for the other.
  const [mode, setMode] = useState<FormMode>(
    landing || joining || params.mode === "signup" ? "signup" : "signin",
  );
  const lock = useRef(false);
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [sent, setSent] = useState(false);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const emailRef = useRef<ComponentRef<typeof TextInput>>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const nameRef = useRef<ComponentRef<typeof TextInput>>(null);
  const [formY, setFormY] = useState(0);
  const { width } = useWindowDimensions();
  const reduced = useReducedMotion();
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
  /** Changes between signing in and creating an account (or back from a reset), keeping what was typed. */
  const switchMode = (next: FormMode) => {
    setMode(next);
    setForgot(false);
    setError(undefined);
    setStatus(undefined);
  };
  async function submit(action: Action) {
    if (lock.current) return;
    setError(undefined);
    setStatus(undefined);
    if (action === "name" && !agreed) return setError("Agree to the Terms of use to continue.");
    if (action !== "name" && !email.trim()) return setError("Enter your email.");
    if ((action === "signin" || action === "signup") && password.length < 6)
      return setError("Use a password of at least six characters.");
    lock.current = true;
    setBusy(action);
    try {
      if (action === "name") {
        const parsed = updateProfileSchema.safeParse({ displayName: name, acceptTerms: true });
        if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Enter a name");
        await request("/me", { method: "PUT", body: parsed.data });
        nameDraft = undefined;
        await auth.refreshProfile();
        return;
      }
      const sb = await getSupabase();
      if (action === "reset") {
        const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: appLink("/reset-password"),
        });
        if (error) throw error;
        setSent(true);
        setStatus(`If there's an account for ${email.trim()}, a reset link is on its way. Check your inbox.`);
      } else if (action === "signup") {
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
      const message = authMessage(error);
      // "There's already an account for that email. Sign in instead.": the card turns to Sign in, email kept.
      if (action === "signup" && message === AUTH_MESSAGES.registered) setMode("signin");
      setError(message);
    } finally {
      setBusy(undefined);
      lock.current = false;
    }
  }
  const primary: Action = nameOnly ? "name" : forgot ? "reset" : mode;
  const creating = mode === "signup";
  const nameFields = (
    <>
      <NamePreview name={name} />
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
      <Text style={[type.small, { color: colors.mutedForeground }]}>
        Read the <TextLink href="/terms">Terms of use</TextLink> and the{" "}
        <TextLink href="/privacy">Privacy policy</TextLink>.
      </Text>
    </>
  );
  const accountFields = (
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
        <View style={{ gap: space.xs }}>
          <Field
            ref={passwordRef}
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            reveal
            // The password manager offers a new password when creating an account, the saved one otherwise.
            autoComplete={creating ? "new-password" : "current-password"}
            textContentType={creating ? "newPassword" : "password"}
            hint={creating ? "At least six characters." : undefined}
            editable={!busy}
            enterKeyHint="go"
            onSubmit={() => void submit(mode)}
          />
          {!creating && (
            <Button
              title="Forgot password?"
              variant="link"
              small
              style={{ alignSelf: "flex-end", paddingHorizontal: 0 }}
              disabled={!!busy}
              onPress={() => {
                setForgot(true);
                setError(undefined);
                setStatus(undefined);
              }}
            />
          )}
        </View>
      )}
    </>
  );
  const primaryTitle =
    primary === "name"
      ? busy === "name"
        ? "Saving…"
        : "Continue"
      : primary === "reset"
        ? busy === "reset"
          ? "Sending…"
          : sent
            ? "Send again"
            : "Send reset link"
        : primary === "signup"
          ? busy === "signup"
            ? "Creating account…"
            : "Create account"
          : busy === "signin"
            ? "Signing in…"
            : "Sign in";
  const form = (
    <Card>
      {nameOnly ? nameFields : <Form>{accountFields}</Form>}
      <ErrorMessage message={error ?? (sent ? undefined : auth.linkError)} />
      <Notice message={status} />
      <Button
        title={primaryTitle}
        busy={busy === primary}
        // Ticking the box is what lets the name step continue, so it stays switched off until then.
        disabled={(!!busy && busy !== primary) || (nameOnly && !agreed)}
        onPress={() => void submit(primary)}
      />
      {!nameOnly &&
        (forgot ? (
          <Button
            title="Back to sign in"
            variant="ghost"
            disabled={!!busy}
            onPress={() => switchMode("signin")}
          />
        ) : (
          <View style={s.switchRow}>
            <Text style={[type.small, { color: colors.mutedForeground }]}>
              {creating ? "Already have an account?" : "New here?"}
            </Text>
            <Button
              title={creating ? "Sign in" : "Create account"}
              variant="link"
              small
              style={{ paddingHorizontal: space.xs }}
              disabled={!!busy}
              onPress={() => switchMode(creating ? "signin" : "signup")}
            />
          </View>
        ))}
      {!nameOnly && (
        <View style={s.legal}>
          <Button
            title="Terms of use"
            variant="link"
            small
            labelTone="muted"
            style={{ paddingHorizontal: 0 }}
            href="/terms"
          />
          <Button
            title="Privacy policy"
            variant="link"
            small
            labelTone="muted"
            style={{ paddingHorizontal: 0 }}
            href="/privacy"
          />
        </View>
      )}
    </Card>
  );
  const heading = nameOnly
    ? "What should we call you?"
    : forgot
      ? "Reset your password"
      : joining
        ? "Join the league"
        : creating
          ? "Create your account"
          : "Welcome back";
  if (!landing)
    return (
      <Screen narrow contentStyle={{ maxWidth: widths.auth, paddingTop: 44 }}>
        <View style={{ gap: space.md }}>
          <Title>{heading}</Title>
          {nameOnly ? (
            <Body muted>This is the name your league sees on the leaderboard.</Body>
          ) : (
            !forgot && (
              <Body muted>
                {joining
                  ? creating
                    ? "Create an account to join the league."
                    : "Sign in to join the league."
                  : "Pick pro football winners against the spread with your league."}
              </Body>
            )
          )}
        </View>
        {form}
      </Screen>
    );
  const shape = landingLayout(width);
  const wide = shape !== "phone";
  const desktop = shape === "desktop";
  // Brings the whole sign-up card into view (its title too), then puts the cursor in Email. In a browser the
  // focus waits for the smooth scroll to settle and doesn't scroll itself: a focus that scrolls the field into
  // view cancels the smooth scroll halfway.
  const getStarted = () => {
    switchMode("signup");
    scroll.current?.scrollTo({ y: Math.max(0, formY - space.xl), animated: !reduced });
    const field = emailRef.current;
    if (!field) return;
    setTimeout(
      () => {
        if (Platform.OS === "web")
          (field as unknown as { focus(options: { preventScroll: boolean }): void }).focus({
            preventScroll: true,
          });
        else field.focus();
      },
      reduced ? 0 : 600,
    );
  };
  return (
    <ScrollView
      ref={scroll}
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.content,
        {
          maxWidth: desktop ? widths.landing : widths.page,
          gap: desktop ? space["5xl"] : 40,
          paddingTop: desktop ? space["5xl"] + space.xl : 36,
          paddingBottom: 64,
        },
      ]}
    >
      <View
        style={{
          flexDirection: wide ? "row" : "column",
          alignItems: wide ? "center" : "stretch",
          gap: desktop ? HERO_GAP.desktop : HERO_GAP.tablet,
        }}
      >
        <View style={{ gap: space["2xl"], flex: desktop ? HERO_SHARE : wide ? 1 : undefined }}>
          <Text style={[type.small, { fontFamily: fonts.semibold, color: colors.primary }]}>
            Your league. Every week. All season.
          </Text>
          <Text
            accessibilityRole="header"
            aria-level={1}
            style={{
              fontFamily: fonts.displayExtraBold,
              ...heroHeadline(width),
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
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.lg }}>
            <Button title="Get started" iconAfter="arrow-right" onPress={getStarted} />
            <Button title="How to play" variant="outline" href="/how-to-play" />
          </View>
          <Body muted style={type.small}>
            Have an invite? Open your commissioner's link to join their league.
          </Body>
        </View>
        <View style={{ flex: wide ? 1 : undefined }}>
          <ExamplePick />
        </View>
      </View>
      <View style={{ gap: space["4xl"] }}>
        <HowAWeekWorks wide={wide} />
        <MoreWays wide={wide} />
      </View>
      <View
        onLayout={(event) => setFormY(event.nativeEvent.layout.y)}
        style={{ width: "100%", maxWidth: widths.auth, alignSelf: "center", gap: space.lg }}
      >
        <Title level={2} size="heading" style={{ textAlign: "center" }}>
          {heading}
        </Title>
        {form}
        <Button
          title="Read the rules & app guide"
          variant="link"
          small
          labelTone="muted"
          style={{ alignSelf: "center" }}
          href="/how-to-play"
        />
      </View>
    </ScrollView>
  );
}

/** The name step's preview: the player's avatar and name as their league will see them, as they type. */
function NamePreview({ name }: { name: string }) {
  const shown = name.trim();
  return (
    <View style={s.preview}>
      {shown ? (
        <Avatar name={shown} size={48} />
      ) : (
        <View aria-hidden accessible={false} style={s.blankAvatar}>
          <Icon name="user" size={24} color={colors.mutedForeground} />
        </View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          numberOfLines={1}
          style={[type.cardTitle, { color: shown ? colors.foreground : colors.mutedForeground }]}
        >
          {shown || "Your name"}
        </Text>
        <Text style={[type.small, { color: colors.mutedForeground }]}>How your league sees you</Text>
      </View>
    </View>
  );
}

/** A click the browser should handle itself: ⌘/Ctrl/Shift-click opens the link in a new tab or window. */
function browserOwns(event: GestureResponderEvent) {
  if (Platform.OS !== "web") return false;
  const click = event as unknown as {
    metaKey?: boolean;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    button?: number;
  };
  return !!(click.metaKey || click.ctrlKey || click.shiftKey) || (click.button ?? 0) !== 0;
}

/** A link inside a line of text: a real `<a href>` on the web, opened through the unsaved-work guard. */
function TextLink({ href, children }: { href: string; children: string }) {
  return (
    <Text
      accessibilityRole="link"
      style={s.textLink}
      {...(Platform.OS === "web" ? ({ href } as object) : null)}
      onPress={(event) => {
        if (browserOwns(event)) return;
        event.preventDefault?.();
        void openPath(href);
      }}
    >
      {children}
    </Text>
  );
}

/** How a week works, in three numbered steps on one card. */
const STEPS = [
  {
    title: "Pick the slate",
    detail: "Choose a side in every game. The spread is the score to beat, and each game locks at kickoff.",
  },
  { title: "Call your POW", detail: "Back one pick for 5 extra points if it wins." },
  { title: "Chase first place", detail: "See everyone's picks and the standings once the week is final." },
];

function HowAWeekWorks({ wide }: { wide: boolean }) {
  return (
    <View style={{ gap: space.lg }}>
      <SectionLabel title="How a week works" />
      <Card style={{ flexDirection: wide ? "row" : "column", gap: wide ? space["3xl"] : space.xl }}>
        {STEPS.map((step, index) => (
          <View key={step.title} style={{ flex: wide ? 1 : undefined, flexDirection: "row", gap: space.lg }}>
            <View aria-hidden accessible={false} style={s.stepNumber}>
              <Text style={[type.statSmall, tabular, { color: colors.primaryText }]}>{index + 1}</Text>
            </View>
            <View style={{ flex: 1, gap: space.xs }}>
              <Title level={3} size="subheading">
                {step.title}
              </Title>
              <Body muted style={type.small}>
                {step.detail}
              </Body>
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

function SectionLabel({ title }: { title: string }) {
  return (
    <Text
      accessibilityRole="header"
      aria-level={2}
      style={[type.small, { fontFamily: fonts.semibold, color: colors.primary }]}
    >
      {title}
    </Text>
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
    <View style={{ gap: space.lg }}>
      <SectionLabel title="More ways to play" />
      <View style={{ flexDirection: wide ? "row" : "column", gap: space.md }}>
        {OTHER_GAMES.map(({ type: game, pitch }) => (
          <AppLink
            key={game}
            href={`/how-to-play?section=${game}`}
            accessibilityLabel={`How ${LEAGUE_TYPE_INFO[game].name} works`}
            style={(state) => [
              webTransition(["background-color"]),
              s.otherGame,
              { flex: wide ? 1 : undefined, backgroundColor: hoverFill(state, colors.card) },
            ]}
          >
            <Icon name={LEAGUE_TYPE_INFO[game].icon} color={colors.mutedForeground} size={20} />
            <View style={{ flex: 1, gap: space.xxs }}>
              <Text style={[type.body, { fontFamily: fonts.semibold, color: colors.foreground }]}>
                {LEAGUE_TYPE_INFO[game].name}
              </Text>
              {wide && <Text style={[type.caption, { color: colors.mutedForeground }]}>{pitch}</Text>}
            </View>
            <Icon name="chevron-right" color={colors.mutedForeground} size={16} />
          </AppLink>
        ))}
      </View>
    </View>
  );
}

/**
 * The example pick, live: tap a team to move the pick, tap POW to light it, and the line under it says what
 * that pick needs and is worth by the real rules. Drawn like the pick sheet's buttons, but its own: nothing is
 * saved.
 */
function ExamplePick() {
  const [side, setSide] = useState<Side>("away");
  const [pow, setPow] = useState(true);
  const caption = exampleCaption(side, pow);
  const choose = (next: Side) => {
    if (next === side) return;
    haptics.select();
    setSide(next);
  };
  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Body muted style={type.small}>
          Monday night · 8:15 PM
        </Body>
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <Badge tone="outline">Example</Badge>
          <Badge>{`${exampleCaption(side, false).points} pts`}</Badge>
        </View>
      </View>
      <View style={{ flexDirection: "row", gap: space.md }}>
        {(["away", "home"] as const).map((team) => (
          <ExampleTeam key={team} side={team} selected={side === team} onPress={() => choose(team)} />
        ))}
        <ExamplePow
          on={pow}
          onPress={() => {
            haptics.toggle();
            setPow(!pow);
          }}
        />
      </View>
      <Text aria-live="polite" style={[type.small, { color: colors.mutedForeground }]}>
        {caption.rule} Worth{" "}
        <Text
          style={{ fontFamily: fonts.semibold, color: colors.foreground }}
        >{`${caption.points}\u00a0points`}</Text>
        {pow ? " as your POW" : ""}.
      </Text>
    </Card>
  );
}

function ExampleTeam({ side, selected, onPress }: { side: Side; selected: boolean; onPress: () => void }) {
  const team = EXAMPLE_GAME[side];
  const line = exampleLine(side);
  const scale = usePop(selected);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${team.name} ${line}${side === "home" ? ", home" : ""}`}
      accessibilityState={{ selected }}
      aria-pressed={selected}
      onPress={onPress}
      style={(state) => [
        s.team,
        selected && s.teamSelected,
        pressTile(state, selected),
        webTransition(["background-color", "opacity", "transform", "box-shadow"]),
      ]}
    >
      {selected && (
        <Animated.View style={[s.mark, { transform: [{ scale }] }]}>
          <Icon name="check-circle" size={16} color={colors.primaryForeground} />
        </Animated.View>
      )}
      <TeamLogo team={team.abbr} size={28} />
      <Text numberOfLines={1} style={[s.teamName, selected && s.selectedText]}>
        {team.name}
      </Text>
      <Text numberOfLines={1} style={[s.line, tabular, selected && s.selectedText]}>
        {line}
        {side === "home" ? " · home" : ""}
      </Text>
    </Pressable>
  );
}

function ExamplePow({ on, onPress }: { on: boolean; onPress: () => void }) {
  const scale = usePop(on);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="POW: Bills at Dolphins"
      accessibilityState={{ selected: on }}
      aria-pressed={on}
      onPress={onPress}
      style={(state) => [
        s.pow,
        on && s.powOn,
        pressTile(state, on),
        webTransition(["background-color", "opacity", "transform", "box-shadow"]),
      ]}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        <Text style={[s.powText, on && { color: colors.powForeground }]}>POW</Text>
      </Animated.View>
    </Pressable>
  );
}

const s = StyleSheet.create({
  switchRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center" },
  legal: { flexDirection: "row", flexWrap: "wrap", columnGap: space["2xl"], justifyContent: "center" },
  textLink: { color: colors.mutedForeground, textDecorationLine: "underline" },
  preview: { flexDirection: "row", alignItems: "center", gap: space.lg },
  blankAvatar: {
    width: 48,
    height: 48,
    borderRadius: radius.full,
    backgroundColor: colors.raised,
    alignItems: "center",
    justifyContent: "center",
  },
  stepNumber: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    backgroundColor: colors.primaryTint,
    alignItems: "center",
    justifyContent: "center",
  },
  otherGame: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: space.lg,
    paddingHorizontal: layout.densePad,
    paddingVertical: space.lg,
    ...corner(radius.lg),
  },
  team: {
    flex: 1,
    minWidth: 0,
    minHeight: 86,
    ...corner(radius.lg),
    backgroundColor: colors.raised,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: space.sm,
    paddingVertical: space.md,
    gap: space.xxs,
  },
  teamSelected: { backgroundColor: colors.primary, boxShadow: elevation.glowPrimary },
  selectedText: { color: colors.primaryForeground },
  mark: { position: "absolute", top: space.sm, right: space.sm },
  teamName: {
    textTransform: "uppercase",
    fontFamily: fonts.displayBold,
    fontSize: 18,
    lineHeight: 20,
    letterSpacing: 0.2,
    color: colors.foreground,
  },
  line: { ...type.small, fontFamily: fonts.medium, lineHeight: 18, color: colors.foreground },
  pow: {
    width: 56,
    ...corner(radius.lg),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.raised,
  },
  powOn: { backgroundColor: colors.powFill, boxShadow: elevation.glowPow },
  powText: {
    ...type.tag,
    fontFamily: fonts.displayExtraBold,
    letterSpacing: 0.8,
    color: colors.mutedForeground,
  },
});

export function AuthGate({ children }: { children: React.ReactNode }) {
  const auth = useAuth();
  if (auth.loading) return <Splash name={auth.me?.displayName ?? undefined} status={!!auth.session} />;
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
