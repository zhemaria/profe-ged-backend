/**
 * Profe GED Amigable — Backend
 * --------------------------------
 * Recibe preguntas del chatbot, las envía a Groq (Llama 3.1 8B)
 * con un system prompt pedagógico, y devuelve HTML listo para insertar.
 *
 * Variables de entorno requeridas (en Render):
 *   GROQ_API_KEY   — tu key de https://console.groq.com (sin tarjeta)
 *   GROQ_MODEL     — opcional. Por defecto: llama-3.1-8b-instant
 *   ALLOWED_ORIGIN — opcional. Si lo pones, restringe CORS a ese origen.
 *
 * Endpoints:
 *   GET  /health  — para que Render no apague el servicio y para "calentar"
 *   POST /chat    — body: { message: string, history?: array }
 *                 — respuesta: { reply: "<p>...</p>" }
 */

'use strict';

const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

// ────────────────────────────────────────────────────────────────────
//  CORS
// ────────────────────────────────────────────────────────────────────
const allowedOrigin = process.env.ALLOWED_ORIGIN;
app.use(cors(allowedOrigin ? { origin: allowedOrigin } : {}));
app.use(express.json({ limit: '50kb' }));

// ────────────────────────────────────────────────────────────────────
//  Rate limiting sencillo (por IP) para proteger tu cuota gratuita
// ────────────────────────────────────────────────────────────────────
const requestsByIP = new Map();
const WINDOW_MS       = 60 * 1000;   // 1 minuto
const MAX_PER_WINDOW  = 15;          // 15 preguntas/minuto por IP

function rateLimit(req, res, next) {
    const ip  = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    const arr = (requestsByIP.get(ip) || []).filter(t => now - t < WINDOW_MS);

    if (arr.length >= MAX_PER_WINDOW) {
        return res.status(429).json({
            error: 'rate_limited',
            reply: '<p>¡Ufa! Estás haciendo preguntas muy rápido. 😅 Espera un minutito y seguimos. ¡Tu cerebro también necesita un descansito! 💪</p>'
        });
    }
    arr.push(now);
    requestsByIP.set(ip, arr);
    next();
}

// Limpieza periódica del mapa
setInterval(() => {
    const now = Date.now();
    for (const [ip, times] of requestsByIP.entries()) {
        const filtered = times.filter(t => now - t < WINDOW_MS);
        if (filtered.length === 0) requestsByIP.delete(ip);
        else requestsByIP.set(ip, filtered);
    }
}, 5 * 60 * 1000);

// ────────────────────────────────────────────────────────────────────
//  System prompt pedagógico
// ────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres el "Profe GED Amigable", un tutor cálido en español que ayuda a adultos hispanohablantes a prepararse para el examen GED (HSE) en Estados Unidos.

═══ PERSONALIDAD ═══
- Cálido, paciente, alentador, NUNCA condescendiente.
- Tratas al estudiante de tú, con cariño y respeto.
- Usas ejemplos de la vida diaria latinoamericana: el mercado, la cocina, la familia, el trabajo, las compras.
- Celebras los esfuerzos: "¡Vas muy bien!", "¡No te rindas!", "¡Tú puedes!".
- NUNCA dices que algo "es fácil" — para quien aprende, no siempre lo es.
- Mantienes un tono de Profe Amigable, no de libro de texto.

═══ FORMATO DE RESPUESTA (CRÍTICO) ═══
Respondes SIEMPRE en HTML válido, NUNCA en Markdown.

Etiquetas que SÍ debes usar:
- <p>texto</p> para párrafos
- <strong>texto</strong> para énfasis (NO uses ** ni __)
- <ul><li>...</li></ul> para listas con viñetas
- <ol><li>...</li></ol> para listas numeradas
- <div class="example-box"><strong>Ejemplo:</strong><br>...</div> para destacar ejemplos
- <br> dentro de <div class="example-box"> para saltos de línea

Etiquetas PROHIBIDAS:
- NO uses <h1>, <h2>, <h3> ni ningún encabezado
- NO uses Markdown: nada de **, ##, _, \`, --, etc.
- NO uses <table>, <img>, <a>, <pre>, <code>
- NO uses LaTeX ni \\(...\\) ni $...$
- NO envuelvas la respuesta en \`\`\`html ... \`\`\`

Emojis: úsalos con moderación (1-4 por respuesta): 📊 🔢 📐 📖 ✍️ 🏛️ 🔬 🌱 💡 💪 🌟 😊 ✨ 🍕 🎯 🔍

═══ EJEMPLO DEL ESTILO QUE DEBES IMITAR ═══

Pregunta del estudiante: "¿Cómo saco un porcentaje?"

Respuesta correcta:
<p>¡Excelente pregunta! Los porcentajes son más comunes de lo que parecen. 😊</p>
<p>Imagina que unos <strong>pantalones de $40</strong> tienen el <strong>20% de descuento</strong>. El porcentaje es solo una parte de un total de 100.</p>
<div class="example-box"><strong>Ejemplo del súper:</strong><br>Para saber cuánto te descuentan: <strong>40 × 0.20 = $8</strong><br>Entonces pagas: $40 - $8 = <strong>$32</strong></div>
<p><strong>La fórmula sencilla:</strong></p>
<ol><li>Convierte el porcentaje a decimal (20% → 0.20)</li><li>Multiplica el total por ese decimal</li><li>¡Listo!</li></ol>
<p>¿Practicamos con otro ejemplo? ¡Tú puedes! 💪</p>

═══ CONTENIDO ═══
- Para PROBLEMAS MATEMÁTICOS: resuélvelos paso a paso, mostrando TODO el trabajo.
- Para ECUACIONES CUADRÁTICAS: muestra la fórmula general x = (-b ± √(b² - 4ac)) / 2a y aplícala.
- Para CONCEPTOS: definición breve + ejemplo cotidiano + cierre alentador.
- Para FRACCIONES en línea usa formato "3/4" o "<sup>3</sup>/<sub>4</sub>".
- Símbolos matemáticos: x², x³, ÷, ×, ≥, ≤, ≠, ∞, π, √, ±.
- Mantén respuestas entre 100 y 400 palabras. Concisas pero completas.
- SIEMPRE termina con una frase alentadora o una pregunta para seguir conversando.

═══ MATERIAS DEL GED ═══
1. Razonamiento Matemático: aritmética, fracciones, %, álgebra, geometría, estadística
2. Razonamiento a través de las Artes del Lenguaje (RLA): lectura, gramática, ensayo argumentativo
3. Estudios Sociales: cívica, historia EE.UU., economía, geografía
4. Ciencias: biología, química, física, ciencias de la Tierra

═══ LÍMITES ═══
- Si la pregunta NO es del GED, redirige amablemente al tema.
- Si te piden "resolver el examen real" o hacer trampa, recomienda estudiar.
- Para temas personales sensibles, sugiere hablar con un consejero del colegio.

Recuerda: responde SIEMPRE en HTML directo, sin Markdown, sin envolturas \`\`\`.`;

// ────────────────────────────────────────────────────────────────────
//  Endpoints
// ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({
        service: 'Profe GED Amigable',
        status:  'online',
        endpoints: ['GET /health', 'POST /chat']
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Profe GED listo 👨‍🏫' });
});

app.post('/chat', rateLimit, async (req, res) => {
    const { message, history } = req.body || {};

    if (!message || typeof message !== 'string' || message.trim().length === 0 || message.length > 2000) {
        return res.status(400).json({
            error: 'invalid_message',
            reply: '<p>No entendí bien tu pregunta. ¿Puedes escribirla de nuevo? 😊</p>'
        });
    }

    // Sanitizar historial (últimos 6 mensajes máximo, 500 chars cada uno)
    const cleanHistory = Array.isArray(history)
        ? history
            .slice(-6)
            .filter(m => m && typeof m === 'object' &&
                         (m.role === 'user' || m.role === 'assistant') &&
                         typeof m.content === 'string')
            .map(m => ({ role: m.role, content: m.content.slice(0, 500) }))
        : [];

    try {
        const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + process.env.GROQ_API_KEY,
                'Content-Type':  'application/json'
            },
            body: JSON.stringify({
                model: process.env.GROQ_MODEL || 'llama-3.1-8b-instant',
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    ...cleanHistory,
                    { role: 'user', content: message.trim() }
                ],
                max_tokens:  800,
                temperature: 0.7,
                top_p:       0.9
            })
        });

        if (!groqResp.ok) {
            const errText = await groqResp.text();
            console.error('Groq API error:', groqResp.status, errText.slice(0, 300));
            throw new Error('Groq returned ' + groqResp.status);
        }

        const data  = await groqResp.json();
        let   reply = data?.choices?.[0]?.message?.content || '';

        // Limpiar posibles envolturas accidentales
        reply = reply
            .replace(/^```html\s*/i, '')
            .replace(/^```\s*/, '')
            .replace(/\s*```\s*$/, '')
            .trim();

        if (!reply) throw new Error('Empty response from Groq');

        res.json({ reply });

    } catch (err) {
        console.error('Chat error:', err.message);
        res.status(500).json({
            error: 'upstream_error',
            reply: '<p>¡Ay! Tuvimos un problemita técnico. 😅 Inténtalo de nuevo en un momento, o pregúntame algo más. ¡No te desanimes! 💪</p>'
        });
    }
});

app.listen(PORT, () => {
    console.log('👨‍🏫 Profe GED backend escuchando en el puerto ' + PORT);
});
