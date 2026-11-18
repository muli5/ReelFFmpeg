import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import ffmpegStatic from "ffmpeg-static";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function main() {
	const audioPath = path.resolve("output/essay1.mp3");
	const alignmentPath = path.resolve("output/essay1.alignment.json");

	if (!existsSync(audioPath) || !existsSync(alignmentPath)) {
		console.error(
			"Faltan los archivos de audio o alineación en output/. Ejecuta 'npm run make' primero.",
		);
		process.exit(1);
	}

	console.log("Analizando frecuencias del audio con FFmpeg...");

	// Usamos ffmpeg-static para analizar el archivo de audio y extraer datos PCM para las barras
	// Esto nos permite calcular la energía de volumen para cada fotograma del video.
	const { stdout, stderr } = await execFileAsync(
		ffmpegStatic,
		[
			"-i",
			audioPath,
			"-map",
			"0:a",
			"-f",
			"s16le",
			"-acodec",
			"pcm_s16le",
			"-ac",
			"1",
			"-ar",
			"16000",
			"pipe:1",
		],
		{ encoding: "buffer", maxBuffer: 50 * 1024 * 1024 },
	);

	console.log(
		`¡Audio analizado correctamente! Buffer de audio recibido (${stdout.length} bytes).`,
	);
	console.log(
		"Listo para configurar el dibujo de barras de frecuencia y subtítulos sincronizados en el siguiente paso.",
	);
}

main().catch((err) => {
	console.error("Error al procesar el renderizado:", err);
	process.exit(1);
});
