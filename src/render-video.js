import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import pkg from "@napi-rs/canvas";
const { createCanvas, registerFont } = pkg;
import ffmpegStatic from "ffmpeg-static";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { execFileSync } from "node:child_process";

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

async function main() {
	const audioPath = path.resolve("output/essay1.mp3");
	const alignmentPath = path.resolve("output/essay1.alignment.json");
	const scriptPath = path.resolve("scripts/essay1.md");
	const outputPath = path.resolve("output/essay1.mp4");

	if (!existsSync(audioPath) || !existsSync(alignmentPath)) {
		console.error(
			"Faltan archivos de audio o alineación en output/. Ejecuta 'npm run make' primero.",
		);
		process.exit(1);
	}

	// Leer título y subtítulo dinámicamente desde el Front Matter de essay1.md
	let scriptTitle = "La leyenda de Anastasia";
	let scriptSubtitle = "Los últimos Romanov · 1918";

	if (existsSync(scriptPath)) {
		const rawScript = await readFile(scriptPath, "utf-8");
		const match = rawScript.match(FRONT_MATTER);
		if (match) {
			const frontMatterContent = match[1];
			const titleMatch = frontMatterContent.match(/^title:\s*(.+)$/m);
			const subtitleMatch = frontMatterContent.match(/^subtitle:\s*(.+)$/m);
			if (titleMatch) scriptTitle = titleMatch[1].trim();
			if (subtitleMatch) scriptSubtitle = subtitleMatch[1].trim();
		}
	}

	// 1. Cargar datos de alineación
	const alignmentRaw = await readFile(alignmentPath, "utf-8");
	const alignment = JSON.parse(alignmentRaw);

	const chars = alignment.characters || [];
	const startTimes = alignment.characterStartTimesSeconds || [];
	const endTimes = alignment.characterEndTimesSeconds || [];

	// Agrupar caracteres en palabras
	const words = [];
	let currentWord = null;
	chars.forEach((char, i) => {
		if (/\s/.test(char)) {
			currentWord = null;
			return;
		}
		if (!currentWord) {
			currentWord = { word: "", start: startTimes[i], end: endTimes[i] };
			words.push(currentWord);
		}
		currentWord.word += char;
		currentWord.end = endTimes[i];
	});

	// Agrupar palabras en frases cortas de hasta 3 palabras para los subtítulos
	const groups = [];
	let currentGroup = [];
	words.forEach((w) => {
		currentGroup.push(w);
		if (currentGroup.length === 3 || /[.,;:!?…]$/.test(w.word)) {
			groups.push(currentGroup);
			currentGroup = [];
		}
	});
	if (currentGroup.length > 0) groups.push(currentGroup);

	const audioStats = await readFile(audioPath);
	const audioDuration = audioStats.length / 16000;

	const width = 1080;
	const height = 1920;
	const fps = 30;
	const totalFrames = Math.ceil(audioDuration * fps);

	console.log(
		"Extrayendo muestras de audio PCM para las barras de frecuencia...",
	);

	// Extraer PCM en bruto usando ffmpeg para analizar amplitudes reales por fotograma
	const pcmBuffer = execFileSync(
		ffmpegStatic,
		[
			"-v",
			"error",
			"-i",
			audioPath,
			"-f",
			"f32le",
			"-ac",
			"1",
			"-ar",
			"44100",
			"pipe:1",
		],
		{ maxBuffer: 1024 * 1024 * 1024 },
	);

	const samples = new Float32Array(
		pcmBuffer.buffer,
		pcmBuffer.byteOffset,
		pcmBuffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
	);

	console.log(
		`Iniciando renderizado de vídeo (${totalFrames} fotogramas a ${fps} fps)...`,
	);

	const ffmpegArgs = [
		"-f",
		"rawvideo",
		"-pix_fmt",
		"rgba",
		"-s",
		`${width}x${height}`,
		"-framerate",
		`${fps}`,
		"-i",
		"pipe:0",
		"-i",
		audioPath,
		"-c:v",
		"libx264",
		"-crf",
		"20",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-t",
		`${audioDuration}`,
		"-y",
		outputPath,
	];

	const ffmpegProcess = spawn(ffmpegStatic, ffmpegArgs, {
		stdio: ["pipe", "inherit", "inherit"],
	});

	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext("2d");

	const numBands = 24;
	const previousLevels = new Array(numBands).fill(0);
	const DECAY = 0.93; // Factor de suavizado para que bajen suavemente

	// 2. Bucle de renderizado por cada fotograma
	for (let frame = 0; frame < totalFrames; frame++) {
		const time = frame / fps;

		// Calcular la sección de muestras de audio correspondientes a este fotograma
		const centerSampleIndex = Math.floor(time * 44100);
		const windowSize = 2048;

		// Fondo oscuro elegante
		ctx.fillStyle = "#1e1318";
		ctx.fillRect(0, 0, width, height);

		// Dibujar Título y Subtítulo dinámicos extraídos de essay1.md
		ctx.fillStyle = "#f3e7c4";
		ctx.font = "bold 56px sans-serif";
		ctx.textAlign = "center";
		ctx.fillText(scriptTitle, width / 2, 350);

		ctx.fillStyle = "#d1b99a";
		ctx.font = "italic 36px sans-serif";
		ctx.fillText(scriptSubtitle, width / 2, 430);

		// Calcular las 24 bandas de energía desde el centro hacia los extremos
		const levels = new Array(numBands).fill(0);

		for (let i = 0; i < numBands; i++) {
			// Hacemos que los índices centrales lean muestras muy cercanas al centro exacto,
			// y los extremos se alejen un poco para que reaccionen con menos intensidad inicial.
			const sampleOffset = centerSampleIndex + i * 280;
			let localEnergy = 0;
			let count = 0;

			for (let s = 0; s < windowSize; s++) {
				const idx = sampleOffset + s;
				if (idx >= 0 && idx < samples.length) {
					localEnergy += Math.abs(samples[idx]);
					count++;
				}
			}

			const avgVal = count > 0 ? localEnergy / count : 0;

			// AQUÍ MODIFICAS LA ALTURA:
			// - Baja el '12' si quieres menos sensibilidad general.
			// - Baja el '220' final para que las barras máximas no sean tan altas.
			// Curva de atenuación cuadrática: el centro (i=0, 1, 2) tiene toda la fuerza;
			// hacia las orillas cae mucho más rápido para que NUNCA inicien los extremos.
			const attenuation = Math.pow(1 - i / numBands, 1.4);
			const rawHeight = Math.min(
				Math.max(Math.pow(avgVal * 14, 1.25) * 230 * attenuation, 14),
				260,
			);

			previousLevels[i] = Math.max(rawHeight, previousLevels[i] * DECAY);
			levels[i] = previousLevels[i];
		}

		// Dibujar las 48 barras en espejo (24 por lado simétricas desde el centro)
		const barCountTotal = 48;
		const barWidth = 10;
		const barGap = 6;
		const totalWidth = barCountTotal * (barWidth + barGap);
		let startX = (width - totalWidth) / 2;

		ctx.lineWidth = barWidth;
		ctx.lineCap = "round";

		// Añadir efecto de brillo/luz dorada a las barras
		ctx.shadowColor = "#f3e7c4";
		ctx.shadowBlur = 15; // Intensidad del brillo estilo luz de radio

		for (let b = 0; b < barCountTotal; b++) {
			// b = 23 y b = 24 son el centro exacto -> leen levels[0]
			// b = 0 y b = 47 son los extremos -> leen levels[23]
			const bandIndex = b < 24 ? 23 - b : b - 24;
			const heightFactor = levels[bandIndex];

			const xPos = startX + b * (barWidth + barGap) + barWidth / 2;
			const yCenter = 960;

			ctx.strokeStyle = "#e6c584";
			ctx.beginPath();
			ctx.moveTo(xPos, yCenter - heightFactor / 2);
			ctx.lineTo(xPos, yCenter + heightFactor / 2);
			ctx.stroke();
		}

		// Limpiar el efecto de sombra para que no afecte a los textos u otros elementos
		ctx.shadowBlur = 0;

		// Dibujar Subtítulos sincronizados palabra por palabra
		const activeGroup = groups.find(
			(g) => time >= g[0].start && time <= g[g.length - 1].end + 0.3,
		);
		if (activeGroup) {
			ctx.font = "800 64px sans-serif";
			ctx.textAlign = "center";

			const textToDisplay = activeGroup.map((w) => w.word).join(" ");

			ctx.strokeStyle = "#000000";
			ctx.lineWidth = 8;
			ctx.strokeText(textToDisplay, width / 2, 1350);

			ctx.fillStyle = "#f3e7c4";
			ctx.fillText(textToDisplay, width / 2, 1350);
		}

		// Enviar fotograma al proceso de FFmpeg en bruto (RGBA)
		const imgData = ctx.getImageData(0, 0, width, height);
		if (!ffmpegProcess.stdin.write(imgData.data)) {
			await once(ffmpegProcess.stdin, "drain");
		}
	}

	ffmpegProcess.stdin.end();
	await once(ffmpegProcess, "close");

	console.log(
		`¡Vídeo generado con éxito y sincronizado con el audio en: ${outputPath}!`,
	);
}

main().catch((err) => {
	console.error("Error al renderizar el vídeo:", err);
	process.exit(1);
});
