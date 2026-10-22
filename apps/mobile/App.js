import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  KeyboardAvoidingView,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";

const API_URL =
  process.env.EXPO_PUBLIC_API_URL ??
  (Platform.OS === "android"
    ? "http://10.0.2.2:4000"
    : "http://localhost:4000");
const LOCATION_TASK = "work-ledger-geofence-pings";

async function request(path, token, options = {}) {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "Request failed");
  return result;
}

TaskManager.defineTask(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const token = await SecureStore.getItemAsync("work-ledger-token");
  if (!token) return;
  const location = data.locations[data.locations.length - 1];
  try {
    const result = await request("/attendance/geofence-ping", token, {
      method: "POST",
      body: JSON.stringify({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        accuracyMeters: location.coords.accuracy ?? undefined,
      }),
    });
    if (!result.insideGeofence) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Outside work area",
          body: result.alert,
          sound: "default",
        },
        trigger: null,
      });
    }
  } catch {}
});

async function requestLocationPermissions() {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== "granted")
    throw new Error("Location permission is required to work a shift.");
  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== "granted")
    throw new Error(
      "Allow background location so work-area checks continue while the app is not open.",
    );
  const notifications = await Notifications.requestPermissionsAsync();
  if (notifications.status !== "granted")
    throw new Error(
      "Allow notifications so outside-area warnings can be heard.",
    );
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("work-area", {
      name: "Work area warnings",
      importance: Notifications.AndroidImportance.HIGH,
      sound: "default",
      vibrationPattern: [0, 300, 150, 300],
    });
  }
}

async function startLocationTask() {
  await requestLocationPermissions();
  if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 120_000,
      distanceInterval: 0,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: "Work Ledger is checking your work location",
        notificationBody: "Location checks pause during breaks and lunch.",
        notificationColor: "#2c664f",
      },
    });
  }
}

async function stopLocationTask() {
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}

function Button({ children, onPress, secondary = false, disabled = false }) {
  return (
    <TouchableOpacity
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        secondary && styles.buttonSecondary,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text
        style={[styles.buttonText, secondary && styles.buttonSecondaryText]}
      >
        {children}
      </Text>
    </TouchableOpacity>
  );
}

function AppContent() {
  const [token, setToken] = useState("");
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [reason, setReason] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function refresh(authToken = token) {
    const [me, current] = await Promise.all([
      request("/me", authToken),
      request("/attendance/current", authToken),
    ]);
    setUser(me.user);
    setSession(current.session);
    if (current.session?.status === "WORKING") {
      try {
        await startLocationTask();
      } catch (error) {
        setMessage(error.message);
      }
    } else await stopLocationTask();
  }

  useEffect(() => {
    SecureStore.getItemAsync("work-ledger-token").then(async (saved) => {
      if (!saved) return;
      setToken(saved);
      try {
        await refresh(saved);
      } catch {
        await SecureStore.deleteItemAsync("work-ledger-token");
      }
    });
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  }, []);

  async function signIn() {
    setBusy(true);
    setMessage("");
    try {
      const result = await request("/auth/login", "", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      if (result.user.role !== "WORKER")
        throw new Error("Worker account required");
      await SecureStore.setItemAsync("work-ledger-token", result.token);
      setToken(result.token);
      await refresh(result.token);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function doCheckIn() {
    setBusy(true);
    setMessage("");
    try {
      await requestLocationPermissions();
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted")
        throw new Error("Location permission is required to check in.");
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      await request("/attendance/check-in", token, {
        method: "POST",
        body: JSON.stringify({
          buildingId: user.building_id,
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
          accuracyMeters: location.coords.accuracy ?? undefined,
        }),
      });
      await refresh();
      setMessage(
        "Checked in. Paid time starts according to your arrival time.",
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function runInterval(action) {
    setBusy(true);
    setMessage("");
    try {
      const [kind, direction] = action.split("-");
      const body =
        direction === "start" && kind === "break"
          ? { reason: reason.trim() }
          : {};
      await request(`/attendance/intervals/${kind}/${direction}`, token, {
        method: "POST",
        body: JSON.stringify(body),
      });
      setReason("");
      setPendingAction("");
      await refresh();
      setMessage(
        direction === "start"
          ? `${kind === "lunch" ? "Lunch" : "Break"} started. Location checks paused.`
          : "Back to work. Location checks resumed.",
      );
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function checkOut() {
    setBusy(true);
    setMessage("");
    try {
      await request("/attendance/check-out", token, {
        method: "POST",
        body: JSON.stringify(reason ? { reason: reason.trim() } : {}),
      });
      await stopLocationTask();
      setSession(null);
      setReason("");
      setPendingAction("");
      setMessage("Shift checked out.");
    } catch (error) {
      if (/reason is required/i.test(error.message))
        setPendingAction("checkout");
      else setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await stopLocationTask();
    await SecureStore.deleteItemAsync("work-ledger-token");
    setToken("");
    setUser(null);
    setSession(null);
  }

  const openInterval =
    session?.status === "BREAK"
      ? "break"
      : session?.status === "LUNCH"
        ? "lunch"
        : null;

  if (!token || !user)
    return (
      <SafeAreaView style={styles.safe}>
        <StatusBar barStyle="dark-content" />

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <ScrollView
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: "center",
            }}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <View style={styles.loginWrap}>
              <Text style={styles.kicker}>WORK LEDGER / STAFF</Text>

              <Text style={styles.heading}>
                Your shift,{"\n"}on the record.
              </Text>

              <Text style={styles.subheading}>
                Sign in with your work account.
              </Text>

              <TextInput
                style={styles.input}
                placeholder="Username"
                autoCapitalize="none"
                autoCorrect={false}
                value={username}
                onChangeText={setUsername}
                returnKeyType="next"
                blurOnSubmit={false}
              />

              <TextInput
                style={styles.input}
                placeholder="Password"
                secureTextEntry
                autoCapitalize="none"
                value={password}
                onChangeText={setPassword}
                returnKeyType="done"
                onSubmitEditing={signIn}
              />

              {message ? (
                <Text accessibilityRole="alert" style={styles.error}>
                  {message}
                </Text>
              ) : null}

              <Button disabled={busy} onPress={signIn}>
                {busy ? "Signing in..." : "Sign in"}
              </Button>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.topline}>
          <View>
            <Text style={styles.kicker}>WORK LEDGER</Text>
            <Text style={styles.greeting}>
              Hello, {user.full_name.split(" ")[0]}
            </Text>
          </View>
          <TouchableOpacity onPress={signOut}>
            <Text style={styles.signOut}>Sign out</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.siteBand}>
          <Text style={styles.siteLabel}>ASSIGNED WORKPLACE</Text>
          <Text style={styles.siteName}>
            {session?.building_name ?? "Your assigned building"}
          </Text>
          <Text style={styles.siteDetail}>
            30 m work area <Text style={styles.dot}>/</Text> 08:00–18:00 shift
          </Text>
        </View>
        {session ? (
          <View style={styles.shiftPanel}>
            <View style={styles.statusRow}>
              <View
                style={[
                  styles.statusDot,
                  openInterval ? styles.statusPaused : null,
                ]}
              />
              <Text style={styles.statusText}>
                {session.status === "WORKING"
                  ? "WORKING"
                  : `${session.status} · LOCATION PAUSED`}
              </Text>
            </View>
            <Text style={styles.shiftTime}>
              Checked in{" "}
              {new Date(session.checked_in_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
            <Text style={styles.secondaryText}>
              Paid time from{" "}
              {new Date(session.paid_start_at).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
            {openInterval ? (
              <Button
                disabled={busy}
                onPress={() => runInterval(`${openInterval}-end`)}
              >
                {openInterval === "lunch" ? "End lunch" : "Continue work"}
              </Button>
            ) : (
              <>
                <View style={styles.buttonRow}>
                  <View style={styles.half}>
                    <Button
                      secondary
                      disabled={busy}
                      onPress={() => setPendingAction("break-start")}
                    >
                      Take a break
                    </Button>
                  </View>
                  <View style={styles.half}>
                    <Button
                      secondary
                      disabled={busy}
                      onPress={() => runInterval("lunch-start")}
                    >
                      Start lunch
                    </Button>
                  </View>
                </View>
                <Button disabled={busy} onPress={checkOut}>
                  Check out
                </Button>
              </>
            )}
          </View>
        ) : (
          <View style={styles.checkinPanel}>
            <Text style={styles.panelLabel}>TODAY&apos;S SHIFT</Text>
            <Text style={styles.panelTitle}>Ready when you are.</Text>
            <Text style={styles.secondaryText}>
              Check-in opens at 07:45. Arriving by 08:00 starts paid time at
              08:00.
            </Text>
            <Button disabled={busy} onPress={doCheckIn}>
              {busy ? "Checking..." : "I came to work"}
            </Button>
          </View>
        )}

        {pendingAction ? (
          <View style={styles.reasonPanel}>
            <Text style={styles.panelLabel}>
              {pendingAction === "checkout"
                ? "CHECK-OUT REASON"
                : "BREAK REASON"}
            </Text>
            <Text style={styles.secondaryText}>
              {pendingAction === "checkout"
                ? "Your check-out is outside the 17:55–18:05 window."
                : "A reason is required before starting a break."}
            </Text>
            <TextInput
              style={[styles.input, styles.reasonInput]}
              placeholder="Write a reason"
              value={reason}
              onChangeText={setReason}
              multiline
            />
            <View style={styles.buttonRow}>
              <View style={styles.half}>
                <Button
                  secondary
                  onPress={() => {
                    setPendingAction("");
                    setReason("");
                  }}
                >
                  Cancel
                </Button>
              </View>
              <View style={styles.half}>
                <Button
                  disabled={!reason.trim() || busy}
                  onPress={() =>
                    pendingAction === "checkout"
                      ? checkOut()
                      : runInterval("break-start")
                  }
                >
                  Continue
                </Button>
              </View>
            </View>
          </View>
        ) : null}
        {message ? (
          <Text accessibilityRole="status" style={styles.notice}>
            {message}
          </Text>
        ) : null}
        <Text style={styles.footnote}>
          Location checks run about every two minutes while you are working, and
          pause during breaks and lunch.
        </Text>
      </ScrollView>
      {busy ? (
        <View style={styles.busy}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#f4f4ed" },
  content: {
    padding: 22,
    paddingBottom: 44,
    maxWidth: 620,
    width: "100%",
    alignSelf: "center",
  },
  loginWrap: {
    flex: 1,
    justifyContent: "center",
    padding: 26,
    maxWidth: 520,
    width: "100%",
    alignSelf: "center",
  },
  kicker: {
    color: "#2c664f",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1.5,
  },
  heading: {
    color: "#1d2925",
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    fontSize: 38,
    lineHeight: 44,
    marginTop: 28,
  },
  subheading: {
    color: "#65716a",
    fontSize: 15,
    marginTop: 9,
    marginBottom: 24,
  },
  input: {
    backgroundColor: "#fff",
    borderColor: "#d8ddd5",
    borderWidth: 1,
    borderRadius: 4,
    color: "#1d2925",
    fontSize: 15,
    minHeight: 50,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  reasonInput: { minHeight: 82, textAlignVertical: "top", paddingTop: 13 },
  button: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2c664f",
    borderRadius: 4,
    minHeight: 50,
    paddingHorizontal: 16,
    marginTop: 12,
  },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  buttonSecondary: {
    backgroundColor: "#fff",
    borderColor: "#bdc9bf",
    borderWidth: 1,
  },
  buttonSecondaryText: { color: "#1d2925" },
  buttonDisabled: { opacity: 0.48 },
  error: { color: "#b63e2d", fontSize: 14, marginVertical: 8 },
  topline: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 15,
  },
  greeting: {
    color: "#1d2925",
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    fontSize: 30,
    marginTop: 7,
  },
  signOut: { color: "#56665c", fontSize: 13, fontWeight: "700", padding: 10 },
  siteBand: {
    backgroundColor: "#e6ebdf",
    borderLeftColor: "#2c664f",
    borderLeftWidth: 4,
    padding: 18,
    marginTop: 14,
  },
  siteLabel: {
    color: "#587064",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  siteName: { color: "#1d2925", fontSize: 19, fontWeight: "700", marginTop: 7 },
  siteDetail: { color: "#65716a", fontSize: 12, marginTop: 5 },
  dot: { color: "#dd593e", fontWeight: "800" },
  shiftPanel: {
    backgroundColor: "#fff",
    borderColor: "#e1e4dc",
    borderWidth: 1,
    padding: 18,
    marginTop: 18,
  },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#34815f",
  },
  statusPaused: { backgroundColor: "#dd593e" },
  statusText: {
    color: "#426150",
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  shiftTime: {
    color: "#1d2925",
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    fontSize: 28,
    marginTop: 17,
  },
  secondaryText: {
    color: "#68736b",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 7,
  },
  buttonRow: { flexDirection: "row", gap: 10 },
  half: { flex: 1 },
  checkinPanel: {
    backgroundColor: "#fff",
    borderColor: "#e1e4dc",
    borderWidth: 1,
    padding: 20,
    marginTop: 18,
  },
  panelLabel: {
    color: "#dd593e",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 1.1,
  },
  panelTitle: {
    color: "#1d2925",
    fontFamily: Platform.OS === "ios" ? "Georgia" : "serif",
    fontSize: 25,
    marginTop: 9,
  },
  reasonPanel: {
    backgroundColor: "#f8f5ea",
    borderColor: "#e6dfc6",
    borderWidth: 1,
    padding: 17,
    marginTop: 14,
  },
  notice: { color: "#2c664f", fontSize: 13, lineHeight: 19, marginTop: 14 },
  footnote: { color: "#788079", fontSize: 11, lineHeight: 17, marginTop: 26 },
  busy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(29,41,37,.12)",
    alignItems: "center",
    justifyContent: "center",
  },
});
