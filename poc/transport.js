// Transport — the ONE keeper artifact from the networking POC.
//
// The real game codes against this interface only. MQTT can later be swapped for
// anything (Firebase, Trystero, a WebSocket relay, ...) without touching game logic.
//
//   interface Transport {
//     connect(roomCode): Promise<void>
//     publish(msg): void                 // fire a JSON message to the room
//     onMessage(cb: (msg) => void)       // receive peers' messages
//     onPresence(cb: (peerIds[]) => void)// who is in the room right now
//     disconnect(): void
//   }
//
// MqttTransport also exposes publishState/onState — a POC convenience for the
// "retained snapshot = state-on-join" trick. These are NOT part of the core keeper
// interface; the real game will decide how it wants snapshots.

import mqtt from 'https://esm.sh/mqtt@5'

export class MqttTransport {
  /** @param {{wssUrl:string, username:string, password:string, topicRoot:string}} cfg */
  constructor(cfg) {
    this.cfg = cfg
    this.peerId = 'p-' + Math.random().toString(36).slice(2, 8)
    this._msgCb = () => {}
    this._presenceCb = () => {}
    this._stateCb = () => {}
    this._online = new Set()
    this.client = null
  }

  _t(suffix) { return `${this.cfg.topicRoot}/${this.room}${suffix}` }

  connect(roomCode) {
    this.room = roomCode
    const presenceMine = this._t(`/presence/${this.peerId}`)
    return new Promise((resolve, reject) => {
      this.client = mqtt.connect(this.cfg.wssUrl, {
        username: this.cfg.username,
        password: this.cfg.password,
        clientId: this.peerId,
        reconnectPeriod: 2000,
        connectTimeout: 8000,
        // Last-Will: if we drop ungracefully, the broker clears our presence.
        will: { topic: presenceMine, payload: '', retain: true, qos: 0 },
      })

      this.client.on('connect', () => {
        this.client.subscribe([
          this._t('/events'),
          this._t('/state'),
          this._t('/presence/+'),
        ], () => {
          // announce ourselves (retained so late joiners see us)
          this.client.publish(presenceMine, JSON.stringify({ id: this.peerId }), { retain: true })
          resolve()
        })
      })

      this.client.on('message', (topic, payload) => {
        const body = payload.toString()
        if (topic.endsWith('/events')) {
          if (body) this._msgCb(JSON.parse(body))
        } else if (topic.endsWith('/state')) {
          if (body) this._stateCb(JSON.parse(body))
        } else if (topic.includes('/presence/')) {
          const id = topic.split('/presence/')[1]
          if (body) this._online.add(id); else this._online.delete(id)
          this._presenceCb([...this._online])
        }
      })

      this.client.on('error', reject)
    })
  }

  publish(msg) { this.client?.publish(this._t('/events'), JSON.stringify(msg)) }

  // POC convenience: retained snapshot for state-on-join.
  publishState(state) { this.client?.publish(this._t('/state'), JSON.stringify(state), { retain: true }) }

  onMessage(cb) { this._msgCb = cb }
  onPresence(cb) { this._presenceCb = cb }
  onState(cb) { this._stateCb = cb }

  disconnect() {
    if (!this.client) return
    // clear our retained presence, then close
    this.client.publish(this._t(`/presence/${this.peerId}`), '', { retain: true }, () => this.client.end())
  }
}
