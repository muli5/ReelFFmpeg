import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

async function main() {
	// 1. Leer el guion desde la carpeta scripts
	const scriptPath = path.resolve("scripts/essay1.md");
	if (!existsSync(scriptPath)) {
		console.error("No se encontró el archivo scripts/essay1.md");
		process.exit(1);
	}

	const raw = await readFile(scriptPath, "utf-8");
	const match = raw.match(FRONT_MATTER);

	if (!match) {
		console.error("El guion no tiene el bloque de metadatos correcto (---)");
		process.exit(1);
	}

	const textContent = raw.slice(match[0].length).trim();
	console.log(`Leyendo guion: "${textContent.slice(0, 40)}..."`);

	// 2. Inicializar el cliente de ElevenLabs (lee ELEVENLABS_API_KEY del .env.local)
	const client = new ElevenLabsClient();

	console.log("Generando audio y marcas de tiempo con ElevenLabs...");

	// Usamos la voz prediseñada 'George' (JBFqnCBsd6RMkjVDRZzb) o puedes cambiar el ID
	const voiceId = "JBFqnCBsd6RMkjVDRZzb";

	const response = await client.textToSpeech.convertWithTimestamps(voiceId, {
		text: textContent,
		modelId: "eleven_v4",
		outputFormat: "mp3_44100_128",
		languageCode: "es",
		voiceSettings: { stability: 0.7, similarityBoost: 0.5 },
	});

	// 3. Guardar el audio generado y las marcas de tiempo
	const outputDir = path.resolve("output");
	if (!existsSync(outputDir)) {
		await mkdir(outputDir, { recursive: true });
	}

	// Convertir el audio base64 a Buffer y guardarlo
	const audioBuffer = Buffer.from(response.audioBase64, "base64");
	await writeFile(path.join(outputDir, "essay1.mp3"), audioBuffer);

	// Guardar la alineación/marcas de tiempo de las palabras y caracteres
	await writeFile(
		path.join(outputDir, "essay1.alignment.json"),
		JSON.stringify(response.alignment, null, 2),
	);

	console.log(
		"¡Listo! Audio y marcas de tiempo guardados en la carpeta output/",
	);
}

main().catch((err) => {
	console.error("Error al generar la narración:", err);
	process.exit(1);
});
