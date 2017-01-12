var myApp = angular.module('myApp', []);

myApp.controller('mainCtrl', function ($scope, $http) {
  window.mainScope = $scope;
  window.myApp = myApp;

  $scope.servDetail = null;
  $scope.alerts = [];
  $scope.authenticated = true;
  $scope.auth = {
    username: '',
    password: ''
  };

  function parseBaseUrl(url) {
    if (!url)
      return '';
    if (url.indexOf('http://') == -1 && url.indexOf('https://') == -1)
      url = 'http://' + url;
    if (url.lastIndexOf('/') + 1 == url.length)
      url = url.slice(0, -1);
    return url;
  }

  function testUrl(url) {
    if (!url)
      return false;
    var ret = false;
    jQuery.ajax({
        url: url + '/api',
        async: false,
        timout: 1500
      })
      .done(function () {
        ret = true;
      })
      .fail(function () {
        ret = false;
      });
    return ret;
  }

  $scope.baseurl = parseBaseUrl(DCE_CONTROLLER_URL);

  // auto detect baseurl
  var _lsUrl = parseBaseUrl(localStorage.baseurl);
  var _localUrl = parseBaseUrl(location.hostname);
  var _refUrl = parseBaseUrl(document.referrer);
  if (testUrl(_lsUrl))
    $scope.baseurl = _lsUrl;
  else if (testUrl(_localUrl))
    $scope.baseurl = _localUrl;
  else if (testUrl(_refUrl))
    $scope.baseurl = _refUrl;
  if ($scope.baseurl.split(':').length > 2)
    $scope.baseAddr = $scope.baseurl.slice(0, $scope.baseurl.lastIndexOf(':'));
  else $scope.baseAddr = $scope.baseurl;

  if (!!localStorage.username)
    $scope.auth.username = localStorage.username;

  if (!!localStorage.password)
    $scope.auth.password = localStorage.password;

  $scope.initModal = function (opt) {
    $('#init-modal').modal(opt);
    $http.get($scope.baseurl + '/networks', getAuthHeader()).then(function (res) {
      var networks = $scope.networks = res.data.filter(function (n) {
        return n.Scope == 'swarm' && n.Name !== 'ingress';
      });
      setTimeout(function () {
        $('#init-net-name').editableSelect({
          filter: false
        });
      });
    });
  };

  $scope.initModalSave = function () {
    var noti = $('#modal-notifier');
    var netName = $('#init-net-name').val();
    var domain = $('#init-domain').val();
    var net = $scope.networks.filter(function (n) {
      return n.Name == netName;
    })[0];

    if (!net) {
      setNoti('正在创建网络...', 'green')
      createNetwork(netName).then(function (res) {
        pollNet(res.data.Id, createServiceCb);
      }).catch(function (res) {
        setNoti('网络创建失败: ' + JSON.stringify(res.data), 'red');
      })
    } else createServiceCb();

    function setNoti(text, color) {
      noti.text(text).css('color', color);
    }

    function pollNet(netId, cb) {
      $http.get($scope.baseurl + '/networks/' + netId, getAuthHeader()).then(cb).catch(function (res) {
        setTimeout(function () {
          pollNet(netId, cb)
        }, 1000);
      });
    }

    function createServiceCb() {
      setNoti('正在创建 Traefik 服务...', 'green')
      createService().then(function (res) {
        pollTask(res.data.ID, function () {
          $scope.initModal('hide');
          $scope.fetchApps();
        });
      }).catch(function (res) {
        setNoti('服务创建失败: ' + JSON.stringify(res.data), 'red');
      })
    }

    function pollTask(sid, cb) {
      $http.get($scope.baseurl + '/tasks?filter=' + JSON.stringify({
        service: [sid]
      }), getAuthHeader()).then(function (res) {
        if (!_.isEmpty(res.data.filter(function (t) {
            return t.Status.State == 'running';
          })))
          cb();
        else setTimeout(function () {
          pollTask(sid, cb)
        }, 2000);
      }).catch(function (res) {
        setTimeout(function () {
          pollTask(sid, cb)
        }, 2000);
      });
    }

    function createNetwork(name) {
      var payload = {
        "Name": name,
        "Driver": "overlay",
        "EnableIPv6": false,
        "Internal": false,
        "Options": {},
        "checkDuplicate": false,
        "IPAM": {
          "Driver": "default",
          "Options": {},
          "Config": []
        },
        "Labels": {
          "io.daocloud.dce.authz.owner": $scope.auth.username
        }
      };
      return $http.post($scope.baseurl + '/networks/create', payload, getAuthHeader());
    }

    function createService() {
      var payload = {
        "Name": "plugin_traefik",
        "EndpointSpec": {
          "Ports": [{
              "TargetPort": 80,
              "PublishedPort": null,
              "Protocol": "tcp"
            },
            {
              "TargetPort": 8080,
              "PublishedPort": null,
              "Protocol": "tcp"
            }
          ],
          "Mode": "vip"
        },
        "Labels": {
          "io.daocloud.dce.traefik": "traefik",
          "io.daocloud.dce.authz.owner": $scope.auth.username,
          "com.docker.stack.namespace": "plugin_traefik"
        },
        "UpdateConfig": {
          "Parallelism": 1
        },
        "Mode": {
          "global": {}
        },
        "Networks": [{
          "Target": netName,
          "Aliases": [
            "traefik"
          ]
        }],
        "TaskTemplate": {
          "RestartPolicy": {},
          "Placement": {
            "Constraints": [
              "node.role==manager"
            ]
          },
          "ContainerSpec": {
            "Labels": {
              "io.daocloud.dce.traefik": "traefik",
              "io.daocloud.dce.authz.owner": $scope.auth.username,
              "com.docker.stack.namespace": "plugin_traefik"
            },
            "Command": [],
            "User": "",
            "Env": [],
            "Mounts": [{
              Target: "/var/run/docker.sock",
              Source: "/var/run/docker.sock",
              ReadOnly: false,
              Type: "bind"
            }],
            "Image": "daocloud.io/daocloud/traefik",
            "Args": [
              "--docker",
              "--docker.swarmmode",
              "--docker.domain=" + domain,
              "--docker.watch",
              "--web"
            ],
            "Dir": ""
          },
          "Resources": {
            "Reservation": {},
            "Limits": {}
          },
          "LogDriver": {
            "Name": "json-file",
            "Options": {
              "max-file": "1",
              "max-size": "50M"
            }
          }
        }
      };
      return $http.post($scope.baseurl + '/services/create', payload, getAuthHeader());
    }

  }

  $scope.initModalKeyDown = function ($event) {
    if ($event.key == 'Enter')
      $scope.initModalSave($scope.baseurl, $scope.auth);
  };

  function getAuthHeader() {
    if (localStorage.DCE_TOKEN)
      return {
        headers: {
          'x-dce-access-token': localStorage.DCE_TOKEN
        }
      };
    else
      return {
        headers: {
          'Authorization': 'Basic ' + btoa($scope.auth.username + ':' + $scope.auth.password)
        }
      };
  }

  $scope.loginModal = function (opt) {
    $('#login-modal').modal(opt);
  };

  $scope.loginModalOnSave = function (baseurl, auth) {
    $scope.baseurl = parseBaseUrl(baseurl);
    if ($scope.baseurl.split(':').length > 2)
      $scope.baseAddr = $scope.baseurl.slice(0, $scope.baseurl.lastIndexOf(':'));
    else $scope.baseAddr = $scope.baseurl;
    $scope.auth = auth;
    $scope.fetchApps();
  };

  $scope.loginModalKeyDown = function ($event) {
    if ($event.key == 'Enter')
      $scope.loginModalOnSave($scope.baseurl, $scope.auth);
  };

  function newAlert(text, level) {
    var alert = {
      id: new Date().valueOf(),
      text: text,
      level: level
    };
    $scope.alerts.push(alert);
    setTimeout(function () {
      jQuery('#alert-' + alert.id).click();
      $scope.alerts.pop();
    }, 5000);
  }

  $scope.setExposedPorts = function (service) {
    image = service.Spec.TaskTemplate.ContainerSpec.Image.replace(/:.*?@sha256:/, '@sha256:');
    $http.get($scope.baseurl + '/images/' + image + '/json', getAuthHeader()).then(function (res) {
      service.exposedPorts = _.keys(res.data.ContainerConfig.ExposedPorts);
    });
  };

  $scope.fetchApps = function () {
    $http.get($scope.baseurl + '/api/apps?System=false', getAuthHeader()).then(function (res) {
      localStorage.username = $scope.auth.username;
      localStorage.password = $scope.auth.password;
      localStorage.baseurl = $scope.baseurl;
      $scope.authenticated = true;
      $scope.loginModal('hide');
      $scope.traefik = {};
      var apps = res.data.filter(function (app) {
        var s = app.Services.filter(function (s) {
          if (!s.Spec.Labels)
            s.Spec.Labels = {};
          return s.Spec.Labels && s.Spec.Labels['io.daocloud.dce.traefik'] === 'traefik';
        });
        if (_.isEmpty(s))
          return true;
        $scope.traefik = s[0];
        $scope.traefik.netId = $scope.traefik.Spec.Networks[0].Target;
        $http.get($scope.baseurl + '/networks/' + $scope.traefik.netId, getAuthHeader()).then(function (res) {
          $scope.traefik.netName = res.data.Name;
        });
        $scope.traefik.lbPort = $scope.traefik.Endpoint.Ports.filter(function (p) {
          return p.TargetPort === 80;
        })[0].PublishedPort;
        $scope.traefik.uiPort = $scope.traefik.Endpoint.Ports.filter(function (p) {
          return p.TargetPort === 8080;
        })[0].PublishedPort;
        $scope.traefik.uiUrl = $scope.baseAddr.replace('https://', 'http://') + ':' + $scope.traefik.uiPort;
        $scope.traefik.domain = $scope.traefik.Spec.TaskTemplate.ContainerSpec.Args.filter(function (a) {
          return a.startsWith('--docker.domain');
        })[0].split('=')[1];
        return false;
      });

      $scope.isInTraefikNet = function (s) {
        if (s.Spec.Networks)
          return !_.isEmpty(s.Spec.Networks.filter(function (n) {
            return n.Target === $scope.traefik.netId;
          }));
        return false;
      };
      $scope.traefikEnabled = function (s) {
        var rules = [$scope.isInTraefikNet(s)];
        if (s.Spec.Labels) {
          rules.push(s.Spec.Labels["traefik.enable"] !== "false" || s.Spec.Labels["traefik.enable"] === "true");
          rules.push(s.Spec.Labels["traefik.port"]);
        }

        return _.every(rules);
      };

      $scope.serviceHost = function (s) {
        rule = s.Spec.Labels['traefik.frontend.rule'];
        if (rule)
          if (rule.startsWith('Host:'))
            return rule.slice(5);
          else {
            s.notSupport = true;
            return newAlert('警告：服务' + s.Spec.Name + '已配置规则 label： “traefik.frontend.rule” 且本编辑器目前无法处理这种规则',
              'alert-warning');
          }
        return s.Spec.Name + '.' + $scope.traefik.domain;
      };
      if (!_.isEmpty($scope.traefik))
        apps.forEach(function (app) {
          app.Services.forEach(function (s) {
            s.traefikEnabled = $scope.traefikEnabled(s);
            s.traefikHost = $scope.serviceHost(s);
            s.traefikPort = s.Spec.Labels['traefik.port'];
            s.lbPort = $scope.traefik.lbPort;
            s.inTraefikNet = $scope.isInTraefikNet(s);
            $scope.setExposedPorts(s);
          });
        });
      $scope.apps = apps;
      $scope.traefikNotFound = false;
      if (apps.length == res.data.length)
        $scope.traefikNotFound = true;
      return res;
    }).catch(function (err) {
      $scope.authenticated = false;
      $scope.loginModal('show');
    });
  };

  $scope.fetchApps();

  $scope.showServiceDetail = function showServiceDetail(serv, app) {
    $scope.servDetail = _.clone(serv);
    $scope.servDetail.appName = app.Name;
    setTimeout(function () {
      jQuery('.help-icon img').tooltip({
        container: 'body'
      });
    }, 2);
  };


  $scope.updateService = function (servDetail) {
    var spec = servDetail.Spec;

    var port = _.parseInt(servDetail.traefikPort);
    if (!servDetail.traefikPort)
      return newAlert('端口不可为空', 'alert-danger');
    else if (!(_.isInteger(port) && (port < 65536) && (port > 0)))
      return newAlert(servDetail.traefikPort + ' 不是一个有效的端口', 'alert-danger');

    //currently modify network of service is not supported
    // var _nets = spec.Networks.filter(function (n) {
    //   return n.Target !== $scope.traefik.netId;
    // });
    // if ($scope.traefikEnabled(servDetail) !== servDetail.traefikEnabled) {
    //   if (servDetail.traefikEnabled)
    //     _nets.push({
    //       Target: $scope.traefik.netId
    //     });
    //   spec.Networks = _nets;
    // }

    //ensure labels
    spec.Labels["traefik.enable"] = servDetail.traefikEnabled ? 'true' : 'false';
    if ($scope.serviceHost(servDetail) !== servDetail.traefikHost) // not default host
      spec.Labels['traefik.frontend.rule'] = 'Host:' + servDetail.traefikHost;
    spec.Labels["traefik.port"] = servDetail.traefikPort;
    if (servDetail.traefikEnabled)
      spec.Labels['io.daocloud.dce.url.TraefikHost'] = 'http://' + servDetail.traefikHost;
    else delete spec.Labels['io.daocloud.dce.url.TraefikHost'];
    spec.Labels['traefik.docker.network'] = $scope.traefik.netName;

    $http.get($scope.baseurl + '/services/' + servDetail.ID, getAuthHeader())
      .then(function (res) {
        var version = res.data.Version.Index;
        return $http.post($scope.baseurl + '/services/' + servDetail.ID + '/update?version=' + version, spec, getAuthHeader());
      })
      .then(function (res) {
        newAlert('配置更新成功，请稍等待其生效', 'alert-success');
        $scope.fetchApps();
      })
      .catch(function (err) {
        newAlert('更新失败', 'alert-danger');
      });
  };
});