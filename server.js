/**
 * Profe GED Amigable — Backend v1.1
 * ------------------------------------
 * Recibe preguntas del chatbot, las envía a Groq, y devuelve HTML
 * listo para insertar.
 *
 * NUEVO en v1.1:
 *   - System prompt reforzado para que separe CADA paso matemático en su <p>.
 *   - Post-procesamiento `ensureHTMLParagraphs()`: si el modelo se rebela
 *     y devuelve texto plano, lo convertimos a <p>...</p> automáticamente.
 *   - Conversión automática de **markdown bold** → <strong>bold</strong>.
 *
 * Variables de entorno (Render):
 *   GROQ_API_KEY   — tu key de https://console.groq.com
 *   GROQ_MODEL     — opcional. Recomendado: llama-3.3-70b-versatile
 *   ALLOWED_ORIGIN — opcional. Si lo pones, restringe CORS a ese origen.
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
//  Rate limiting sencillo (por IP)
// ────────────────────────────────────────────────────────────────────
const requestsByIP = new Map();
const WINDOW_MS       = 60 * 1000;
const MAX_PER_WINDOW  = 15;

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

setInterval(() => {
    const now = Date.now();
    for (const [ip, times] of requestsByIP.entries()) {
        const filtered = times.filter(t => now - t < WINDOW_MS);
        if (filtered.length === 0) requestsByIP.delete(ip);
        else requestsByIP.set(ip, filtered);
    }
}, 5 * 60 * 1000);

// ────────────────────────────────────────────────────────────────────
//  System prompt pedagógico (REFORZADO en v1.1)
// ────────────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres el "Profe GED Amigable", un tutor cálido en español que ayuda a adultos hispanohablantes a prepararse para el examen GED (HSE) en Estados Unidos.

═══ PERSONALIDAD ═══
- Cálido, paciente, alentador, NUNCA condescendiente.
- Tratas al estudiante de tú, con cariño y respeto.
- Usas ejemplos de la vida diaria latinoamericana: el mercado, la cocina, la familia, el trabajo, las compras.
- Celebras los esfuerzos: "¡Vas muy bien!", "¡No te rindas!", "¡Tú puedes!".
- NUNCA dices que algo "es fácil" — para quien aprende, no siempre lo es.

═══ FORMATO DE RESPUESTA (REGLA DE ORO) ═══
Respondes SIEMPRE en HTML válido, NUNCA en Markdown.

🔴 REGLA CRÍTICA #1: TODO párrafo de texto va envuelto en <p>...</p>.
   No envíes texto suelto sin etiquetas. Cada idea separada = su propio <p>.

🔴 REGLA CRÍTICA #2: En problemas matemáticos, CADA paso del cálculo va
   en su PROPIO <p>. NO los pongas en un solo bloque corrido.

   ❌ MAL:
   <p>x = (-(3) ± √((3)² - 4(1)(-5))) / 2(1) x = (-3 ± √(9 + 20)) / 2 x = (-3 ± √29) / 2</p>

   ✅ BIEN:
   <p>x = (-(3) ± √((3)² - 4(1)(-5))) / 2(1)</p>
   <p>x = (-3 ± √(9 + 20)) / 2</p>
   <p>x = (-3 ± √29) / 2</p>

Etiquetas que SÍ debes usar:
- <p>texto</p> para CADA párrafo o paso (sin excepción)
- <strong>texto</strong> para énfasis (NO uses ** ni __)
- <ul><li>...</li></ul> para listas con viñetas
- <ol><li>...</li></ol> para listas numeradas
- <div class="example-box"><strong>Ejemplo:</strong><br>...</div> para destacar ejemplos

Etiquetas PROHIBIDAS:
- NO uses <h1>, <h2>, <h3> ni encabezados
- NO uses Markdown: nada de **, ##, _, \`, --, etc.
- NO uses <table>, <img>, <a>, <pre>, <code>
- NO uses LaTeX ni \\(...\\) ni $...$
- NO envuelvas la respuesta en \`\`\`html ... \`\`\`

Emojis: úsalos con moderación (1-4 por respuesta): 📊 🔢 📐 📖 ✍️ 🏛️ 🔬 🌱 💡 💪 🌟 😊 ✨ 🍕 🎯 🔍

═══ EJEMPLO COMPLETO DE FORMATO CORRECTO ═══

Pregunta del estudiante: "Resuelve x² + 3x - 5 = 0"

Respuesta correcta (NOTA cómo cada paso va en su propio <p>):
<p>¡Vamos a resolver esa ecuación cuadrática paso a paso! 🔢</p>
<p>La fórmula general para resolver ecuaciones cuadráticas (ax² + bx + c = 0) es:</p>
<p><strong>x = (-b ± √(b² - 4ac)) / 2a</strong></p>
<p>En tu ecuación identificamos los valores:</p>
<ul>
<li><strong>a = 1</strong> (el coeficiente de x²)</li>
<li><strong>b = 3</strong> (el coeficiente de x)</li>
<li><strong>c = -5</strong> (el término constante)</li>
</ul>
<p>Ahora sustituimos esos valores en la fórmula:</p>
<p>x = (-(3) ± √((3)² - 4(1)(-5))) / 2(1)</p>
<p>x = (-3 ± √(9 + 20)) / 2</p>
<p>x = (-3 ± √29) / 2</p>
<div class="example-box"><strong>Las dos soluciones son:</strong><br>x₁ = (-3 + √29) / 2 ≈ <strong>1.19</strong><br>x₂ = (-3 - √29) / 2 ≈ <strong>-4.19</strong></div>
<p>💡 <strong>Tip del Profe:</strong> Siempre que el discriminante (lo que está dentro de la raíz, b² - 4ac) sea positivo, vas a tener dos soluciones reales.</p>
<p>¿Quieres practicar con otra ecuación? ¡Vas muy bien! 💪</p>

═══ EJEMPLO PARA CONCEPTOS (NO PROBLEMAS) ═══

Pregunta del estudiante: "¿Cómo saco un porcentaje?"

Respuesta correcta:
<p>¡Excelente pregunta! Los porcentajes son más comunes de lo que parecen. 😊</p>
<p>Imagina que unos <strong>pantalones de $40</strong> tienen el <strong>20% de descuento</strong>. El porcentaje es solo una parte de un total de 100.</p>
<div class="example-box"><strong>Ejemplo del súper:</strong><br>Para saber cuánto te descuentan: <strong>40 × 0.20 = $8</strong><br>Entonces pagas: $40 - $8 = <strong>$32</strong></div>
<p><strong>La fórmula sencilla:</strong></p>
<ol><li>Convierte el porcentaje a decimal (20% → 0.20)</li><li>Multiplica el total por ese decimal</li><li>¡Listo!</li></ol>
<p>¿Practicamos con otro ejemplo? ¡Tú puedes! 💪</p>

═══ CONTENIDO ═══
- Para PROBLEMAS MATEMÁTICOS: resuélvelos paso a paso, mostrando TODO el trabajo, CADA PASO EN SU PROPIO <p>.
- Para ECUACIONES CUADRÁTICAS: muestra la fórmula y aplícala paso a paso.
- Para CONCEPTOS: definición breve + ejemplo cotidiano + cierre alentador.
- Símbolos matemáticos: x², x³, ÷, ×, ≥, ≤, ≠, ∞, π, √, ±.
- Mantén respuestas entre 100 y 400 palabras.
- SIEMPRE termina con una frase alentadora o una pregunta para seguir.

═══ MATERIAS DEL GED ═══
1. Razonamiento Matemático: aritmética, fracciones, %, álgebra, geometría, estadística
2. Razonamiento a través de las Artes del Lenguaje (RLA): lectura, gramática, ensayo
3. Estudios Sociales: cívica, historia EE.UU., economía, geografía
4. Ciencias: biología, química, física, ciencias de la Tierra

═══ LÍMITES ═══
- Si la pregunta NO es del GED, redirige amablemente al tema.
- Si te piden "resolver el examen real" o hacer trampa, recomienda estudiar.
- Para temas personales sensibles, sugiere hablar con un consejero del colegio.

Recuerda la REGLA DE ORO: TODO va envuelto en etiquetas HTML, CADA paso matemático en su propio <p>.`;

// ────────────────────────────────────────────────────────────────────
//  Post-procesamiento de respuesta (NUEVO en v1.1)
//  Garantiza que la respuesta tenga formato HTML correcto incluso si
//  el modelo se "rebela" y devuelve texto plano con saltos de línea.
// ────────────────────────────────────────────────────────────────────
function ensureHTMLParagraphs(html) {
    if (!html || typeof html !== 'string') return html;

    // 1. Quitar envolturas accidentales de markdown
    html = html
        .replace(/^```html\s*/i, '')
        .replace(/^```\s*/, '')
        .replace(/\s*```\s*$/, '')
        .trim();

    // 2. Markdown bold → <strong>
    html = html.replace(/\*\*([^*\n]+?)\*\*/g, '<strong>$1</strong>');

    // 3. Markdown italic → texto normal (no usamos itálicas)
    html = html.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1$2');

    // 4. Si ya viene bien formateado (3+ <p> reales), confiamos en él
    const pCount = (html.match(/<p[\s>]/gi) || []).length;
    if (pCount >= 3) {
        return html;
    }

    // 5. Si no, preservamos bloques HTML conocidos y envolvemos los textos
    //    sueltos en <p>. Splitea por bloques (div, ul, ol, table, p ya existentes).
    const blockRegex = /(<(?:div|ul|ol|table|p)[^>]*>[\s\S]*?<\/(?:div|ul|ol|table|p)>)/gi;
    const segments = html.split(blockRegex);

    const formatted = segments.map(segment => {
        if (!segment) return '';

        // Si es un bloque HTML, déjalo tal cual
        if (/^<(div|ul|ol|table|p)/i.test(segment.trim())) {
            return segment;
        }

        // Es texto: divide por dobles saltos (párrafos) y envuelve cada uno en <p>
        return segment
            .split(/\n{2,}/)
            .map(p => p.trim())
            .filter(p => p.length > 0)
            .map(p => {
                // Si el párrafo ya empieza con etiqueta HTML, lo dejamos
                if (/^<[a-z]/i.test(p)) return p;
                // Saltos de línea simples dentro del párrafo → <br>
                p = p.replace(/\n/g, '<br>');
                return '<p>' + p + '</p>';
            })
            .join('\n');
    }).join('\n');

    return formatted.trim();
}

// ────────────────────────────────────────────────────────────────────
//  Endpoints
// ────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({
        service: 'Profe GED Amigable',
        version: '1.1',
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
                model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    ...cleanHistory,
                    { role: 'user', content: message.trim() }
                ],
                max_tokens:  900,
                temperature: 0.6,
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

        // 🆕 Aplicar post-procesamiento para garantizar HTML correcto
        reply = ensureHTMLParagraphs(reply);

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
    console.log('👨‍🏫 Profe GED backend v1.1 escuchando en el puerto ' + PORT);
});
