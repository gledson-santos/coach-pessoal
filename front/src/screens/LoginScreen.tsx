import React, { useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

type Props = {
  tenantId: string;
  onTenantChange: (value: string) => void;
  onLogin: (email: string, password: string) => Promise<void>;
  onForgotPassword: (email: string) => Promise<void>;
  onSignupPress: () => void;
  onSocialLogin: (provider: "google" | "microsoft" | "facebook") => Promise<void>;
  providers: { provider: "google" | "microsoft" | "facebook"; configured: boolean }[];
};

export default function LoginScreen({
  tenantId,
  onTenantChange,
  onLogin,
  onForgotPassword,
  onSignupPress,
  onSocialLogin,
  providers,
}: Props) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const providerMap = useMemo(
    () =>
      providers.reduce(
        (acc, item) => {
          acc[item.provider] = item.configured;
          return acc;
        },
        {} as Record<"google" | "microsoft" | "facebook", boolean>
      ),
    [providers]
  );

  const handleLogin = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await onLogin(email, senha);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao entrar.");
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async () => {
    setLoading(true);
    setMessage(null);
    try {
      await onForgotPassword(email);
      setMessage("Se existir uma conta, enviamos as instrucoes de reset.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao solicitar reset.");
    } finally {
      setLoading(false);
    }
  };

  const handleSocial = async (provider: "google" | "microsoft" | "facebook") => {
    setLoading(true);
    setMessage(null);
    try {
      await onSocialLogin(provider);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha no login social.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.titulo}>Bem-vindo(a)</Text>
        <Text style={styles.subtitulo}>
          Acesse sua conta para continuar sua jornada com o Coach Pessoal.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.secaoTitulo}>Entrar com email e senha</Text>
        <TextInput
          style={styles.input}
          placeholder="Tenant ID"
          value={tenantId}
          onChangeText={onTenantChange}
          autoCapitalize="none"
        />
        <TextInput
          style={styles.input}
          placeholder="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Senha"
          value={senha}
          onChangeText={setSenha}
          secureTextEntry
        />
        <TouchableOpacity style={styles.acaoPrimaria} onPress={handleLogin} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.acaoPrimariaTexto}>Entrar</Text>}
        </TouchableOpacity>
        <TouchableOpacity onPress={handleForgot} disabled={loading}>
          <Text style={styles.link}>Esqueceu sua senha?</Text>
        </TouchableOpacity>
        {message ? <Text style={styles.feedback}>{message}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.secaoTitulo}>Ou use login social</Text>
        <TouchableOpacity
          style={[styles.socialButton, styles.googleButton]}
          onPress={() => handleSocial("google")}
          disabled={!providerMap.google || loading}
        >
          <Ionicons name="logo-google" size={20} color="#db4437" />
          <Text style={styles.socialText}>Continuar com Google</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.socialButton, styles.microsoftButton]}
          onPress={() => handleSocial("microsoft")}
          disabled={!providerMap.microsoft || loading}
        >
          <Ionicons name="logo-windows" size={20} color="#2563eb" />
          <Text style={styles.socialText}>Continuar com Microsoft</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.socialButton, styles.facebookButton]}
          onPress={() => handleSocial("facebook")}
          disabled={!providerMap.facebook || loading}
        >
          <Ionicons name="logo-facebook" size={20} color="#1877f2" />
          <Text style={styles.socialText}>Continuar com Facebook</Text>
        </TouchableOpacity>
        <Text style={styles.hint}>
          Os botoes ficam disponiveis somente quando o tenant possui credenciais configuradas.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.secaoTitulo}>Ainda nao tem conta?</Text>
        <Text style={styles.secaoTexto}>
          Crie sua conta com email e senha para começar.
        </Text>
        <TouchableOpacity style={styles.acaoSecundaria} onPress={onSignupPress}>
          <Text style={styles.acaoSecundariaTexto}>Criar conta</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.alerta}>
        <Text style={styles.alertaTitulo}>Privacidade e seguranca</Text>
        <Text style={styles.alertaTexto}>
          Toda configuracao de integracao e acesso e feita pelo proprio usuario.
          Nenhum usuario tem acesso a informacoes de outros usuarios, garantindo
          isolamento total dos dados e evitando falhas de seguranca.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 20,
    backgroundColor: "#f6f7f9",
  },
  header: {
    marginBottom: 20,
  },
  titulo: {
    fontSize: 28,
    fontWeight: "700",
    color: "#264653",
  },
  subtitulo: {
    fontSize: 15,
    color: "#6b7280",
    marginTop: 6,
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  secaoTitulo: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1f2937",
    marginBottom: 10,
  },
  secaoTexto: {
    fontSize: 14,
    color: "#6b7280",
    marginBottom: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    padding: 12,
    fontSize: 15,
    marginBottom: 10,
    backgroundColor: "#f9fafb",
  },
  acaoPrimaria: {
    backgroundColor: "#264653",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 6,
  },
  acaoPrimariaTexto: {
    color: "#fff",
    fontWeight: "600",
  },
  link: {
    marginTop: 10,
    color: "#2563eb",
    fontWeight: "500",
    textAlign: "center",
  },
  socialButton: {
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 8,
    marginBottom: 10,
    backgroundColor: "#fff",
  },
  socialText: {
    marginLeft: 10,
    fontSize: 15,
    fontWeight: "500",
    color: "#111827",
  },
  googleButton: {
    borderColor: "#f3d2cf",
  },
  microsoftButton: {
    borderColor: "#c7d2fe",
  },
  facebookButton: {
    borderColor: "#c7dcff",
  },
  acaoSecundaria: {
    backgroundColor: "#e6f4f1",
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: "center",
    marginTop: 6,
  },
  acaoSecundariaTexto: {
    color: "#0f766e",
    fontWeight: "600",
  },
  alerta: {
    padding: 16,
    backgroundColor: "#ecfeff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#a5f3fc",
    marginBottom: 24,
  },
  alertaTitulo: {
    fontSize: 15,
    fontWeight: "600",
    color: "#155e75",
    marginBottom: 6,
  },
  alertaTexto: {
    fontSize: 13,
    color: "#0e7490",
    lineHeight: 18,
  },
  feedback: {
    marginTop: 10,
    fontSize: 13,
    color: "#b91c1c",
    textAlign: "center",
  },
  hint: {
    marginTop: 6,
    fontSize: 12,
    color: "#6b7280",
  },
});
