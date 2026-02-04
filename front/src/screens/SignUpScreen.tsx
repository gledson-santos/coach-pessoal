import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from "react-native";

type Props = {
  tenantId: string;
  onTenantChange: (value: string) => void;
  onSignUp: (email: string, password: string) => Promise<void>;
  onBack: () => void;
};

export default function SignUpScreen({ tenantId, onTenantChange, onSignUp, onBack }: Props) {
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSignUp = async () => {
    if (senha !== confirmacao) {
      setMessage("As senhas nao conferem.");
      return;
    }
    setLoading(true);
    setMessage(null);
    try {
      await onSignUp(email, senha);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao criar conta.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <View style={styles.header}>
        <Text style={styles.titulo}>Criar conta</Text>
        <Text style={styles.subtitulo}>
          Cadastre-se com email e senha para acessar o Coach Pessoal.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.secaoTitulo}>Dados da conta</Text>
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
        <TextInput
          style={styles.input}
          placeholder="Confirmar senha"
          value={confirmacao}
          onChangeText={setConfirmacao}
          secureTextEntry
        />
        <Text style={styles.hint}>
          Senha minima: 8+ caracteres, 1 numero e 1 caractere especial.
        </Text>
        <TouchableOpacity style={styles.acaoPrimaria} onPress={handleSignUp} disabled={loading}>
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.acaoPrimariaTexto}>Criar conta</Text>}
        </TouchableOpacity>
        {message ? <Text style={styles.feedback}>{message}</Text> : null}
        <TouchableOpacity onPress={onBack} disabled={loading}>
          <Text style={styles.link}>Ja tenho conta</Text>
        </TouchableOpacity>
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
    marginTop: 12,
    color: "#2563eb",
    fontWeight: "500",
    textAlign: "center",
  },
  hint: {
    fontSize: 12,
    color: "#6b7280",
    marginBottom: 10,
  },
  feedback: {
    marginTop: 10,
    fontSize: 13,
    color: "#b91c1c",
    textAlign: "center",
  },
});
