import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  SafeAreaView,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { WebView } from "react-native-webview";

const APP_URL = "https://nexgen-ai-chat-ctkdev.vercel.app";

export default function App() {
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const retry = useCallback(() => {
    setFailed(false);
    setLoading(true);
    setReloadKey((key) => key + 1);
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#080b12" />
      <View style={styles.container}>
        <WebView
          key={reloadKey}
          source={{ uri: APP_URL }}
          style={styles.webview}
          startInLoadingState
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          onLoadStart={() => {
            setFailed(false);
            setLoading(true);
          }}
          onLoadEnd={() => setLoading(false)}
          onError={() => {
            setLoading(false);
            setFailed(true);
          }}
          onShouldStartLoadWithRequest={(request) => {
            if (request.url.startsWith(APP_URL)) return true;
            Linking.openURL(request.url);
            return false;
          }}
        />
        {loading && (
          <View style={styles.loadingOverlay}>
            <ActivityIndicator size="large" color="#8b5cf6" />
            <Text style={styles.loadingText}>Loading nexGen…</Text>
          </View>
        )}
        {failed && (
          <View style={styles.errorOverlay}>
            <Text style={styles.title}>nexGen is temporarily unavailable</Text>
            <Text style={styles.message}>
              Check your connection and try loading the app again.
            </Text>
            <TouchableOpacity style={styles.button} onPress={retry}>
              <Text style={styles.buttonText}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#080b12",
  },
  container: {
    flex: 1,
    backgroundColor: "#080b12",
  },
  webview: {
    flex: 1,
    backgroundColor: "#080b12",
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#080b12",
  },
  loadingText: {
    color: "#a7afc0",
    fontSize: 14,
  },
  errorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 28,
    backgroundColor: "#080b12",
  },
  title: {
    color: "#f6f7fb",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  message: {
    color: "#a7afc0",
    fontSize: 15,
    lineHeight: 22,
    marginTop: 10,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#8b5cf6",
    borderRadius: 12,
    marginTop: 22,
    paddingHorizontal: 22,
    paddingVertical: 12,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "700",
  },
});