const market = async () => {
  Vue.component(VueQrcode.name, VueQrcode)

  const nostr = window.NostrTools
  const defaultRelays = [
    'wss://relay.damus.io',
    'wss://relay.snort.social',
    'wss://nos.lol',
    'wss://nostr.wine',
    'wss://relay.nostr.bg',
    'wss://nostr-pub.wellorder.net',
    'wss://nostr-pub.semisol.dev',
    'wss://eden.nostr.land',
    'wss://nostr.mom',
    'wss://nostr.fmt.wiz.biz',
    'wss://nostr.zebedee.cloud',
    'wss://nostr.rocks'
  ]
  const eventToObj = event => {
    event.content = JSON.parse(event.content)
    return {
      ...event,
      ...Object.values(event.tags).reduce((acc, tag) => {
        let [key, value] = tag
        return {...acc, [key]: [...(acc[key] || []), value]}
      }, {})
    }
  }
  await Promise.all([
    productCard('static/components/product-card/product-card.html'),
    customerMarket('static/components/customer-market/customer-market.html'),
    customerStall('static/components/customer-stall/customer-stall.html'),
    productDetail('static/components/product-detail/product-detail.html')
  ])

  new Vue({
    el: '#vue',
    mixins: [windowMixin],
    data: function () {
      return {
        drawer: false,
        pubkeys: new Set(),
        relays: new Set(),
        events: [],
        stalls: [],
        products: [],
        profiles: new Map(),
        searchText: null,
        exchangeRates: null,
        inputPubkey: null,
        inputRelay: null,
        activePage: 'market',
        activeStall: null,
        activeProduct: null
      }
    },
    computed: {
      filterProducts() {
        let products = this.products
        if (this.activeStall) {
          products = products.filter(p => p.stall == this.activeStall)
        }
        if (!this.searchText || this.searchText.length < 2) return products
        return products.filter(p => {
          return (
            p.name.includes(this.searchText) ||
            p.description.includes(this.searchText) ||
            p.categories.includes(this.searchText)
          )
        })
      },
      stallName() {
        return this.stalls.find(s => s.id == this.activeStall)?.name || 'Stall'
      },
      productName() {
        return (
          this.products.find(p => p.id == this.activeProduct)?.name || 'Product'
        )
      }
    },
    async created() {
      // Check for stored merchants and relays on localStorage
      try {
        let merchants = this.$q.localStorage.getItem(`diagonAlley.merchants`)
        let relays = this.$q.localStorage.getItem(`diagonAlley.relays`)
        if (merchants && merchants.length) {
          this.pubkeys = new Set(merchants)
        }
        if (relays && relays.length) {
          this.relays = new Set([...defaultRelays, ...relays])
        }
      } catch (e) {
        console.error(e)
      }
      // Hardcode pubkeys for testing
      /*
          this.pubkeys.add(
            'c1415f950a1e3431de2bc5ee35144639e2f514cf158279abff9ed77d50118796'
          )
          this.pubkeys.add(
            '8f69ac99b96f7c4ad58b98cc38fe5d35ce02daefae7d1609c797ce3b4f92f5fd'
          )
          */
      // stall ids S4hQgtTwiF5kGJZPbqMH9M  jkCbdtkXeMjGBY3LBf8yn4
      /*let naddr = nostr.nip19.naddrEncode({
            identifier: '1234',
            pubkey:
              'c1415f950a1e3431de2bc5ee35144639e2f514cf158279abff9ed77d50118796',
            kind: 30018,
            relays: defaultRelays
          })
          console.log(naddr)
          console.log(nostr.nip19.decode(naddr))
          */
      let params = new URLSearchParams(window.location.search)
      let merchant_pubkey = params.get('merchant_pubkey')
      let stall_id = params.get('stall_id')
      let product_id = params.get('product_id')
      console.log(merchant_pubkey, stall_id, product_id)
      if (merchant_pubkey) {
        await addPubkey(merchant_pubkey)
        /*LNbits.utils
              .confirmDialog(
                `We found a merchant pubkey in your request. Do you want to add it to the merchants list?`
              )
              .onCancel(() => {})
              .onDismiss(() => {})
              .onOk(() => {
                this.pubkeys.add(merchant_pubkey)
              })*/
      }
      this.$q.loading.show()
      this.relays = new Set(defaultRelays)
      // Get notes from Nostr
      await this.initNostr()

      // What component to render on start
      if (stall_id) {
        if (product_id) {
          this.activeProduct = product_id
        }
        this.activePage = 'stall'
        this.activeStall = stall_id
      }

      this.$q.loading.hide()
    },
    methods: {
      async initNostr() {
        const pool = new nostr.SimplePool()
        let relays = Array.from(this.relays)
        let products = new Map()
        let stalls = new Map()
        // Get metadata and market data from the pubkeys
        let sub = await pool
          .list(relays, [
            {
              kinds: [0, 30017, 30018], // for production kind is 30017
              authors: Array.from(this.pubkeys)
            }
          ])
          .then(events => {
            console.log(events)
            this.events = events || []
            this.events.map(eventToObj).map(e => {
              if (e.kind == 0) {
                this.profiles.set(e.pubkey, e.content)
                return
              } else if (e.kind == 30018) {
                //it's a product `d` is the prod. id
                products.set(e.d, {...e.content, id: e.d, categories: e.t})
              } else if (e.kind == 30017) {
                // it's a stall `d` is the stall id
                stalls.set(e.d, {...e.content, id: e.d, pubkey: e.pubkey})
                return
              }
            })
          })
        await Promise.resolve(sub)
        this.stalls = await Array.from(stalls.values())

        this.products = Array.from(products.values()).map(obj => {
          let stall = this.stalls.find(s => s.id == obj.stall_id)
          obj.stallName = stall.name
          if (obj.currency != 'sat') {
            obj.formatedPrice = this.getAmountFormated(obj.price, obj.currency)
            obj.priceInSats = this.getValueInSats(obj.price, obj.currency)
          }
          return obj
        })

        pool.close(relays)
      },
      async getRates() {
        let noFiat = this.stalls.map(s => s.currency).every(c => c == 'sat')
        if (noFiat) return
        try {
          let rates = await axios.get('https://api.opennode.co/v1/rates')
          this.exchangeRates = rates.data.data
        } catch (error) {
          LNbits.utils.notifyApiError(error)
        }
      },
      navigateTo(page, opts = {stall: null, product: null, pubkey: null}) {
        let {stall, product, pubkey} = opts
        let url = new URL(window.location)

        if (pubkey) url.searchParams.set('merchant_pubkey', pubkey)
        if (stall && !pubkey) {
          pubkey = this.stalls.find(s => s.id == stall).pubkey
          url.searchParams.set('merchant_pubkey', pubkey)
        }

        switch (page) {
          case 'stall':
            if (stall) {
              this.activeStall = stall
              url.searchParams.set('stall_id', stall)
              if (product) {
                this.activeProduct = product
                url.searchParams.set('product_id', product)
              }
            }
            break
          default:
            this.activeStall = null
            this.activeProduct = null
            url.searchParams.delete('merchant_pubkey')
            url.searchParams.delete('stall_id')
            url.searchParams.delete('product_id')
            break
        }

        window.history.pushState({}, '', url)
        this.activePage = page
      },

      getValueInSats(amount, unit = 'USD') {
        if (!this.exchangeRates) return 0
        return Math.ceil(
          (amount / this.exchangeRates[`BTC${unit}`][unit]) * 1e8
        )
      },
      getAmountFormated(amount, unit = 'USD') {
        return LNbits.utils.formatCurrency(amount, unit)
      },
      async addPubkey(pubkey = null) {
        if (!pubkey) {
          pubkey = String(this.inputPubkey).trim()
        }
        let regExp = /^#([0-9a-f]{3}){1,2}$/i
        if (pubkey.startsWith('n')) {
          try {
            let {type, data} = nostr.nip19.decode(pubkey)
            if (type === 'npub') pubkey = data
            else if (type === 'nprofile') {
              pubkey = data.pubkey
              givenRelays = data.relays
            }
            this.pubkeys.add(pubkey)
            this.inputPubkey = null
          } catch (err) {
            console.error(err)
          }
        } else if (regExp.test(pubkey)) {
          pubkey = pubkey
        }
        this.pubkeys.add(pubkey)
        this.$q.localStorage.set(
          `diagonAlley.merchants`,
          Array.from(this.pubkeys)
        )
        await this.initNostr()
      },
      removePubkey(pubkey) {
        // Needs a hack for Vue reactivity
        let pubkeys = this.pubkeys
        pubkeys.delete(pubkey)
        this.profiles.delete(pubkey)
        this.pubkeys = new Set(Array.from(pubkeys))
        this.$q.localStorage.set(
          `diagonAlley.merchants`,
          Array.from(this.pubkeys)
        )
      },
      async addRelay() {
        let relay = String(this.inputRelay).trim()
        if (!relay.startsWith('ws')) {
          console.debug('invalid url')
          return
        }
        this.relays.add(relay)
        this.$q.localStorage.set(`diagonAlley.relays`, Array.from(this.relays))
        this.inputRelay = null
        await this.initNostr()
      },
      removeRelay(relay) {
        // Needs a hack for Vue reactivity
        let relays = this.relays
        relays.delete(relay)
        this.relays = new Set(Array.from(relays))
        this.$q.localStorage.set(`diagonAlley.relays`, Array.from(this.relays))
      }
    }
  })
}

market()
